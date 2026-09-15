<?php
/**
 * Post types pterodocs publishes into.
 *
 * Documentation is published as pages, because documentation is what a page
 * is: hierarchical, ordered by hand, and part of the site's own structure.
 * Release notes are not. They are dated, they accumulate, they want an archive
 * ordered newest first, and nobody wants a hundred of them in the page tree.
 *
 * So a site can register a post type for them, and pterodocs publishes into it
 * instead. The two ends have to agree on three things — the rewrite base, the
 * REST base, and that the type is hierarchical — and getting any of them wrong
 * fails in a way that is hard to read, so this file is the one place they are
 * decided and `pterodocs doctor` reads them back.
 *
 * There is no PHP test harness here and this does not add one: the arguments
 * are built by a pure function so they can be read and diffed, and the wire
 * contract is covered from the TypeScript side against a fake WordPress.
 *
 * @package pterodocs
 */

declare( strict_types = 1 );

namespace Pterodocs;

defined( 'ABSPATH' ) || exit;

/**
 * Registers the post types and taxonomies pterodocs publishes into.
 */
final class PostTypes {

	/**
	 * Marks a post as one pterodocs wrote.
	 *
	 * Ownership is read off the page's own markup everywhere else, which works
	 * because a documentation page always carries the generated layout. A
	 * release note need not: with no navigation column and no breadcrumb it is
	 * a body and nothing else, and then prune, purge and the stylesheet all
	 * stop recognising it. A registered meta key is the honest answer, and the
	 * usual objection to one — that WordPress rejects unregistered meta over
	 * REST — does not apply to a post type we register ourselves.
	 */
	public const META_SOURCE = '_pterodocs_source';

	/** Bumped when the registered rewrites change, so an existing install re-flushes. */
	private const RULES_VERSION = '1';

	/** Option holding the rules version this site has flushed. */
	private const RULES_OPTION = 'pterodocs_post_type_rules';

	/**
	 * Wire it up.
	 *
	 * On `init` at priority 5, before `Llms::register` at the default 10: the
	 * llms routes and metadata are registered per post type, and they cannot be
	 * registered for a type that does not exist yet.
	 */
	public static function init(): void {
		add_action( 'init', array( self::class, 'register' ), 5 );
	}

	/**
	 * The post types this site publishes into.
	 *
	 * Configured through the settings option, so a sync can be pointed at a new
	 * one without editing PHP; the filter is the code-first way to do the same,
	 * for a site that would rather keep this in version control.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	public static function configured(): array {
		$stored = Settings::get( 'postTypes' );
		$types  = is_array( $stored ) ? $stored : array();

		/**
		 * Filter the post types pterodocs registers.
		 *
		 * @param array<int, array<string, mixed>> $types Each with `name`, `base`, `label`, `taxonomy`.
		 */
		$types = apply_filters( 'pterodocs_post_types', $types );

		$valid = array();
		foreach ( is_array( $types ) ? $types : array() as $type ) {
			if ( ! is_array( $type ) ) {
				continue;
			}
			$name = isset( $type['name'] ) ? sanitize_key( (string) $type['name'] ) : '';
			$base = isset( $type['base'] ) ? trim( (string) $type['base'], '/' ) : '';

			// A type with no name has nothing to register, and one with no base
			// would claim the site root.
			if ( '' === $name || '' === $base ) {
				continue;
			}

			$valid[] = array(
				'name'     => $name,
				'base'     => $base,
				'label'    => isset( $type['label'] ) && '' !== $type['label']
					? (string) $type['label']
					: __( 'Release notes', 'pterodocs' ),
				'taxonomy' => isset( $type['taxonomy'] ) ? sanitize_key( (string) $type['taxonomy'] ) : '',
			);
		}

		return $valid;
	}

	/** Just the names, for the places that only need those. */
	public static function names(): array {
		return array_column( self::configured(), 'name' );
	}

	/**
	 * The arguments one post type is registered with.
	 *
	 * Pure, so it can be read without a WordPress running. Every non-obvious
	 * value here is load-bearing:
	 *
	 * - `hierarchical` both on the type and inside `rewrite`. Without the first
	 *   there is no `parent` and the tree flattens; without the second a nested
	 *   post's permalink loses its ancestors and stops matching the URLs
	 *   pterodocs published in its links.
	 * - `with_front` false, or the permalink structure's front — `/blog`, say —
	 *   is prepended to the base and every URL is wrong by one segment.
	 * - `has_archive` as the base *string*, not `true`. It is the index: the
	 *   page a reader lands on, which is why pterodocs publishes no root page
	 *   for this tree.
	 * - `rest_base` as the name, so the route the sync writes to is decided
	 *   here rather than guessed there.
	 * - `page-attributes`, or `menu_order` is absent from REST and the order
	 *   differs on every single run.
	 * - `custom-fields`, or the whole `meta` field is missing from the REST
	 *   schema — so every metadata write fails, on a site where the plugin is
	 *   plainly installed. It is the most confusing symptom this can produce.
	 * - `map_meta_cap`, or the capabilities map to ones nobody holds and the
	 *   sync is refused on everything.
	 *
	 * @param array<string, mixed> $type One entry from `configured()`.
	 * @return array<string, mixed> Arguments for `register_post_type`.
	 */
	public static function args( array $type ): array {
		$label = (string) $type['label'];

		return array(
			'labels'        => array(
				'name'          => $label,
				'singular_name' => $label,
				'menu_name'     => $label,
			),
			'public'        => true,
			'show_in_rest'  => true,
			'rest_base'     => (string) $type['name'],
			'hierarchical'  => true,
			'has_archive'   => (string) $type['base'],
			'menu_icon'     => 'dashicons-media-text',
			'map_meta_cap'  => true,
			'supports'      => array(
				'title',
				'editor',
				'excerpt',
				'author',
				'thumbnail',
				'revisions',
				'page-attributes',
				'custom-fields',
			),
			'rewrite'       => array(
				'slug'         => (string) $type['base'],
				'with_front'   => false,
				'hierarchical' => true,
			),
		);
	}

	/**
	 * The arguments the companion taxonomy is registered with.
	 *
	 * Flat, because Docusaurus tags are flat.
	 *
	 * @param array<string, mixed> $type One entry from `configured()`.
	 * @return array<string, mixed> Arguments for `register_taxonomy`.
	 */
	public static function taxonomy_args( array $type ): array {
		return array(
			'labels'            => array( 'name' => __( 'Tags', 'pterodocs' ) ),
			'public'            => true,
			'hierarchical'      => false,
			'show_in_rest'      => true,
			'show_admin_column' => true,
			'rewrite'           => array(
				'slug'       => (string) $type['base'] . '/tag',
				'with_front' => false,
			),
		);
	}

	/**
	 * Register everything, and flush once when what is registered changes.
	 */
	public static function register(): void {
		$types = self::configured();

		foreach ( $types as $type ) {
			register_post_type( $type['name'], self::args( $type ) );

			if ( '' !== $type['taxonomy'] ) {
				register_taxonomy( $type['taxonomy'], $type['name'], self::taxonomy_args( $type ) );
			}

			register_post_meta(
				$type['name'],
				self::META_SOURCE,
				array(
					'single'        => true,
					'type'          => 'string',
					'default'       => '',
					'show_in_rest'  => true,
					'auth_callback' => static function ( $allowed, $meta_key, $post_id ) {
						return current_user_can( 'edit_post', (int) $post_id );
					},
				)
			);
		}

		// The rules a post type adds only exist once they have been flushed, and
		// what is registered can change without the plugin being reactivated —
		// somebody adds a type on the settings page, or changes a base. The
		// fingerprint covers both, so a flush happens exactly when it must.
		$want = self::RULES_VERSION . ':' . md5( (string) wp_json_encode( $types ) );

		if ( get_option( self::RULES_OPTION ) !== $want ) {
			flush_rewrite_rules( false );
			update_option( self::RULES_OPTION, $want, false );
		}
	}

	/**
	 * Make the routes live the moment the plugin is switched on.
	 */
	public static function activate(): void {
		self::register();
		flush_rewrite_rules( false );
	}

	/**
	 * Leave no rules behind pointing at a post type that is no longer registered.
	 *
	 * The posts themselves are left exactly where they are. Deactivating a
	 * plugin is not a request to delete anything, and a release note is
	 * somebody's writing.
	 */
	public static function deactivate(): void {
		delete_option( self::RULES_OPTION );
		flush_rewrite_rules( false );
	}
}
