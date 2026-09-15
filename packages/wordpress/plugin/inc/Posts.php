<?php
/**
 * What a published post needs from WordPress that a page does not.
 *
 * Documentation is published as pages: hierarchical, ordered by hand, part of
 * the site's own structure — which is what a page is. Release notes are
 * ordinary posts, because that is what they are: dated, accumulating, and
 * belonging in the site's feed, its categories and its RSS alongside everything
 * else written there.
 *
 * Publishing them needs almost nothing from this plugin. WordPress already has
 * the post type, the category and tag taxonomies, the archive and the feed. The
 * one thing missing is a way to tell, later, which posts pterodocs wrote — so
 * that is all this registers.
 *
 * @package pterodocs
 */

declare( strict_types = 1 );

namespace Pterodocs;

defined( 'ABSPATH' ) || exit;

/**
 * Registers the metadata pterodocs writes on a post.
 */
final class Posts {

	/**
	 * Marks a post as one pterodocs wrote.
	 *
	 * Ownership is read off the page's own markup everywhere else, which works
	 * because a documentation page always carries the generated layout. A
	 * release note does not: with no navigation column and no breadcrumb it is
	 * a body and nothing else, and then prune, purge and the stylesheet all
	 * stop recognising it. A registered meta key is the honest answer, and the
	 * usual objection to one — that WordPress rejects unregistered meta over
	 * REST — is exactly what registering it removes.
	 */
	public const META_SOURCE = '_pterodocs_source';

	/** The value that key carries. */
	public const SOURCE = 'pterodocs';

	/**
	 * The types pterodocs publishes into.
	 *
	 * Both built in, so there is nothing to register and nothing for the two
	 * ends to disagree about.
	 *
	 * @return array<int, string>
	 */
	public static function types(): array {
		return array( 'page', 'post' );
	}

	/**
	 * Wire it up.
	 */
	public static function init(): void {
		add_action( 'init', array( self::class, 'register' ) );
	}

	/**
	 * Register the ownership marker on every type pterodocs writes to.
	 */
	public static function register(): void {
		foreach ( self::types() as $type ) {
			register_post_meta(
				$type,
				self::META_SOURCE,
				array(
					'single'        => true,
					'type'          => 'string',
					'default'       => '',
					// Exposed over REST because that is how pterodocs writes it:
					// with an application password, as the user running the sync.
					'show_in_rest'  => true,
					'auth_callback' => static function ( $allowed, $meta_key, $post_id ) {
						return current_user_can( 'edit_post', (int) $post_id );
					},
				)
			);
		}
	}

	/**
	 * Whether pterodocs wrote this post.
	 *
	 * @param \WP_Post|null $post The post, or null.
	 * @return bool
	 */
	public static function is_ours( $post ): bool {
		if ( ! $post instanceof \WP_Post ) {
			return false;
		}

		return self::SOURCE === (string) get_post_meta( $post->ID, self::META_SOURCE, true );
	}
}
