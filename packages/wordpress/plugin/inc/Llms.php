<?php
/**
 * Serving the files an LLM reads instead of the documentation.
 *
 * pterodocs builds `llms.txt` and `llms-full.txt` from what it published — the
 * sidebar's own hierarchy, and this site's URLs — and stores them on the
 * documentation root page. This class is the half that hands them back.
 *
 * They are served from the documentation's own root rather than from the site
 * root, which is a deliberate trade. The convention at https://llmstxt.org puts
 * `/llms.txt` at the top of a site, but a site is not a documentation set: the
 * root file is supposed to describe everything published at that domain, other
 * plugins reasonably claim it, and pterodocs only ever knows about its own
 * tree. Describing a subtree from a path that promises the whole site would be
 * a lie that quietly gets worse as the site grows.
 *
 * WordPress serves nothing statically, so there is no file on disk to find:
 * a rewrite rule turns the request into a query, and this answers it.
 *
 * @package pterodocs
 */

declare( strict_types = 1 );

namespace Pterodocs;

defined( 'ABSPATH' ) || exit;

/**
 * Stores and serves llms.txt for each published documentation tree.
 */
final class Llms {

	/**
	 * Where the index is kept.
	 *
	 * On the documentation root page rather than in an option, so that a site
	 * publishing two documentation sets gets two of them, each one is removed
	 * with the page it belongs to, and nothing has to be configured for the
	 * plugin to know where a tree begins.
	 */
	public const META_INDEX = '_pterodocs_llms_index';

	/** Where the full text is kept. */
	public const META_FULL = '_pterodocs_llms_full';

	/** Bumped when the rewrite rules change, so an existing install re-flushes. */
	private const RULES_VERSION = '1';

	/** Option holding the rules version this site has flushed. */
	private const RULES_OPTION = 'pterodocs_llms_rules';

	/** Transient holding the ids of every documentation root. */
	private const ROOTS_TRANSIENT = 'pterodocs_llms_roots';

	/**
	 * Wire it up.
	 */
	public static function init(): void {
		add_action( 'init', array( self::class, 'register' ) );
		add_filter( 'query_vars', array( self::class, 'query_vars' ) );
		add_action( 'template_redirect', array( self::class, 'serve' ) );
		add_filter( 'redirect_canonical', array( self::class, 'no_canonical_redirect' ), 10, 2 );
		add_action( 'wp_head', array( self::class, 'link_tag' ) );
		add_filter( 'robots_txt', array( self::class, 'robots' ), 10, 2 );

		// The list of roots is small and changes only when a sync runs.
		foreach ( array( 'added_post_meta', 'updated_post_meta', 'deleted_post_meta' ) as $hook ) {
			add_action( $hook, array( self::class, 'forget_roots' ), 10, 3 );
		}
	}

	/**
	 * Register the metadata and the routes.
	 */
	public static function register(): void {
		// Every type pterodocs publishes into, not only pages: a tree in a post
		// type of its own has an llms.txt exactly as a documentation tree does.
		$types = array_merge( array( 'page' ), PostTypes::names() );

		foreach ( array( self::META_INDEX, self::META_FULL ) as $key ) {
			foreach ( $types as $type ) {
				register_post_meta(
					$type,
					$key,
					array(
						'single'        => true,
						'type'          => 'string',
						'default'       => '',
						// Exposed over REST because that is how pterodocs writes
						// it: with an application password, as the user running
						// the sync.
						'show_in_rest'  => true,
						'auth_callback' => static function ( $allowed, $meta_key, $post_id ) {
							return current_user_can( 'edit_post', (int) $post_id );
						},
					)
				);
			}
		}

		// `(.+?)` is lazy so that a page whose own slug ends in `llms` cannot
		// swallow the filename.
		add_rewrite_rule( '^(.+?)/llms\.txt$', 'index.php?pterodocs_llms=$matches[1]', 'top' );
		add_rewrite_rule( '^(.+?)/llms-full\.txt$', 'index.php?pterodocs_llms=$matches[1]&pterodocs_llms_full=1', 'top' );

		if ( get_option( self::RULES_OPTION ) !== self::RULES_VERSION ) {
			flush_rewrite_rules( false );
			update_option( self::RULES_OPTION, self::RULES_VERSION, false );
		}
	}

	/**
	 * Let the two query variables through.
	 *
	 * @param array<int, string> $vars Recognised query variables.
	 * @return array<int, string> The same, with ours added.
	 */
	public static function query_vars( array $vars ): array {
		$vars[] = 'pterodocs_llms';
		$vars[] = 'pterodocs_llms_full';
		return $vars;
	}

	/**
	 * Answer a request for one of the two files.
	 *
	 * Anything unrecognised is left alone, so WordPress goes on to 404 exactly
	 * as it would have without this plugin.
	 */
	public static function serve(): void {
		$path = get_query_var( 'pterodocs_llms' );
		if ( ! is_string( $path ) || '' === $path ) {
			return;
		}

		// `get_page_by_path` looks at pages unless told otherwise, so a tree
		// published into a post type of its own would never be found.
		$page = get_page_by_path( $path, OBJECT, array_merge( array( 'page' ), PostTypes::names() ) );
		if ( ! $page instanceof \WP_Post ) {
			return;
		}

		$key     = get_query_var( 'pterodocs_llms_full' ) ? self::META_FULL : self::META_INDEX;
		$content = get_post_meta( $page->ID, $key, true );

		// A page that is not a documentation root, or a tree published before
		// this was a feature, simply has nothing here.
		if ( ! is_string( $content ) || '' === $content ) {
			return;
		}

		status_header( 200 );
		header( 'Content-Type: text/plain; charset=utf-8' );
		header( 'X-Robots-Tag: noindex' );

		if ( 'HEAD' === ( $_SERVER['REQUEST_METHOD'] ?? '' ) ) {
			exit;
		}

		// Deliberately not escaped: the response is text/plain, so there is no
		// markup context to escape into, and escaping would corrupt the file.
		echo $content; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		exit;
	}

	/**
	 * Keep WordPress from putting a trailing slash on a filename.
	 *
	 * Permalinks here end in a slash, so `redirect_canonical` sees
	 * `.../llms.txt`, decides it is missing one, and 301s to `.../llms.txt/`.
	 * The request still resolves — the rewrite is matched against a trimmed
	 * path — but the address an agent was told to use answers with a redirect
	 * instead of the file, and `llms.txt` without the slash is the convention.
	 *
	 * @param string|false $redirect Where WordPress means to send the request.
	 * @param string       $requested The URL that was asked for.
	 * @return string|false False for our own requests, otherwise unchanged.
	 */
	public static function no_canonical_redirect( $redirect, $requested ) {
		unset( $requested );
		return get_query_var( 'pterodocs_llms' ) ? false : $redirect;
	}

	/**
	 * Every page that carries an index, newest first.
	 *
	 * @return array<int, int> Page ids.
	 */
	public static function roots(): array {
		$cached = get_transient( self::ROOTS_TRANSIENT );
		if ( is_array( $cached ) ) {
			return $cached;
		}

		$roots = get_posts(
			array(
				'post_type'        => array_merge( array( 'page' ), PostTypes::names() ),
				'post_status'      => 'publish',
				'meta_key'         => self::META_INDEX, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'fields'           => 'ids',
				'posts_per_page'   => 20,
				'no_found_rows'    => true,
				'suppress_filters' => false,
			)
		);

		$roots = array_map( 'intval', (array) $roots );
		set_transient( self::ROOTS_TRANSIENT, $roots, DAY_IN_SECONDS );

		return $roots;
	}

	/**
	 * Drop the cached list when one of our keys is written.
	 *
	 * @param int    $meta_id  Ignored.
	 * @param int    $post_id  Ignored.
	 * @param string $meta_key The key that changed.
	 */
	public static function forget_roots( $meta_id, $post_id, $meta_key ): void {
		if ( self::META_INDEX === $meta_key || self::META_FULL === $meta_key ) {
			delete_transient( self::ROOTS_TRANSIENT );
		}
	}

	/**
	 * The documentation root a page belongs to, if any.
	 *
	 * @param int $post_id A page.
	 * @return int The root's id, or 0.
	 */
	private static function root_for( int $post_id ): int {
		$roots = self::roots();
		if ( ! $roots ) {
			return 0;
		}

		if ( in_array( $post_id, $roots, true ) ) {
			return $post_id;
		}

		foreach ( get_post_ancestors( $post_id ) as $ancestor ) {
			if ( in_array( (int) $ancestor, $roots, true ) ) {
				return (int) $ancestor;
			}
		}

		return 0;
	}

	/**
	 * Point at the file from the pages it describes.
	 *
	 * There is no standard way to advertise an `llms.txt` that does not sit at
	 * the site root — the convention *is* the path — so this is a hint rather
	 * than a mechanism. It costs one link element on documentation pages only.
	 */
	public static function link_tag(): void {
		if ( ! is_singular( array_merge( array( 'page' ), PostTypes::names() ) ) ) {
			return;
		}

		$root = self::root_for( (int) get_queried_object_id() );
		if ( ! $root ) {
			return;
		}

		printf(
			'<link rel="alternate" type="text/plain" title="llms.txt" href="%s" />' . "\n",
			esc_url( self::url_for( $root, false ) )
		);
	}

	/**
	 * Mention the files in robots.txt.
	 *
	 * As a comment, because there is no agreed directive for this and inventing
	 * one would only mislead whatever parses the file.
	 *
	 * @param string $output   The robots.txt body so far.
	 * @param bool   $is_public Whether the site asks to be indexed.
	 * @return string The body, with our lines appended.
	 */
	public static function robots( $output, $is_public ): string {
		$output = (string) $output;
		if ( ! $is_public ) {
			return $output;
		}

		foreach ( self::roots() as $root ) {
			$output .= sprintf( "\n# llms.txt: %s", self::url_for( $root, false ) );
			if ( '' !== (string) get_post_meta( $root, self::META_FULL, true ) ) {
				$output .= sprintf( "\n# llms-full.txt: %s", self::url_for( $root, true ) );
			}
		}

		return $output;
	}

	/**
	 * Where one tree's file lives.
	 *
	 * @param int  $root A documentation root page.
	 * @param bool $full Whether to name the full text rather than the index.
	 * @return string An absolute URL.
	 */
	private static function url_for( int $root, bool $full ): string {
		$name = $full ? 'llms-full.txt' : 'llms.txt';
		return trailingslashit( (string) get_permalink( $root ) ) . $name;
	}

	/**
	 * Make the routes live the moment the plugin is switched on.
	 */
	public static function activate(): void {
		self::register();
		flush_rewrite_rules( false );
	}

	/**
	 * Leave no rules behind pointing at a plugin that is no longer there.
	 */
	public static function deactivate(): void {
		delete_option( self::RULES_OPTION );
		delete_transient( self::ROOTS_TRANSIENT );
		flush_rewrite_rules( false );
	}
}
