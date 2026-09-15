<?php
/**
 * Loading the stylesheet and the scripts, and only where they are wanted.
 *
 * The decision is made at `wp_enqueue_scripts` from the queried post's stored
 * content, rather than during rendering: a style enqueued while the content
 * filter is running has already missed `wp_head`, and the page flashes
 * unstyled before it arrives.
 *
 * @package pterodocs
 */

declare( strict_types = 1 );

namespace Pterodocs;

defined( 'ABSPATH' ) || exit;

/**
 * Conditional asset loading.
 */
final class Assets {

	/**
	 * Memoised answer for this request.
	 *
	 * @var bool|null
	 */
	private static ?bool $should_load = null;

	/**
	 * Register the hooks.
	 */
	public static function init(): void {
		add_action( 'wp_enqueue_scripts', array( self::class, 'enqueue' ) );
		add_action( 'enqueue_block_editor_assets', array( self::class, 'editor' ) );
	}

	/**
	 * The content of the post being displayed, if there is one.
	 */
	private static function content(): string {
		if ( is_admin() || ! is_singular() ) {
			return '';
		}

		$post = get_post();

		return $post instanceof \WP_Post ? (string) $post->post_content : '';
	}

	/**
	 * Whether this request is showing a page pterodocs published.
	 *
	 * Documentation is recognised by the class pterodocs puts on the layout it
	 * generates. Nothing loads anywhere else on the site.
	 */
	public static function should_load(): bool {
		if ( null !== self::$should_load ) {
			return self::$should_load;
		}

		// A post type registered for pterodocs holds nothing but what pterodocs
		// published, so it does not have to prove it in its markup. It often
		// cannot: a release note with no navigation column and no breadcrumb
		// carries no generated class at all.
		$types = PostTypes::names();
		if ( $types && ( is_singular( $types ) || is_post_type_archive( $types ) ) ) {
			self::$should_load = true;

			return true;
		}

		$content = self::content();

		if ( '' === $content ) {
			self::$should_load = false;

			return false;
		}

		$prefix = Settings::get( 'classPrefix' );
		$prefix = is_string( $prefix ) && '' !== $prefix ? $prefix : 'pterodocs';

		self::$should_load = str_contains( $content, $prefix . '-docs' );

		return self::$should_load;
	}

	/**
	 * Whether the editor is editing a page pterodocs published.
	 *
	 * `should_load` cannot answer this: it deliberately returns false in the
	 * admin, because it is about the page being *shown*. The editor needs the
	 * same question asked of the post being *edited* — and asking it matters,
	 * because the alternative is what this plugin did until now: load its
	 * inspector panel into every block editor on the site, including posts,
	 * products, the site editor and every other plugin's screens. A panel that
	 * has nothing to say about a block it does not own has no business being
	 * loaded next to it.
	 */
	private static function editing_documentation(): bool {
		$post = get_post();

		if ( ! $post instanceof \WP_Post ) {
			return false;
		}

		$prefix = Settings::get( 'classPrefix' );
		$prefix = is_string( $prefix ) && '' !== $prefix ? $prefix : 'pterodocs';

		return str_contains( (string) $post->post_content, $prefix . '-docs' );
	}

	/**
	 * Load the front-end assets.
	 */
	public static function enqueue(): void {
		if ( ! self::should_load() ) {
			return;
		}

		// The design is registered with no file of its own: `docs.css` is written
		// with `{p}` where the class prefix goes, because the prefix is a
		// per-site setting and a static file cannot carry it. Filling it in here
		// is what lets one stylesheet serve whatever prefix a site published
		// with — and lets `render.styles` be 'none', so the design is fetched
		// once for the site rather than stored on every page.
		wp_register_style( 'pterodocs', false, array(), VERSION );
		wp_enqueue_style( 'pterodocs' );
		wp_add_inline_style( 'pterodocs', self::design() );
		wp_add_inline_style( 'pterodocs', self::custom_properties() );

		// What needs a script, and therefore has no counterpart in a stylesheet
		// stored with the content. Written against the plugin's own classes, so
		// it is a real file that browsers can cache.
		wp_enqueue_style( 'pterodocs-plugin', PTERODOCS_URL . 'assets/css/plugin.css', array( 'pterodocs' ), VERSION );

		wp_enqueue_script( 'pterodocs', PTERODOCS_URL . 'assets/js/docs.js', array(), VERSION, true );
		wp_set_script_translations( 'pterodocs', 'pterodocs', PTERODOCS_DIR . 'languages' );

		Prism::enqueue( self::content() );
	}

	/**
	 * The generated stylesheet, with this site's class prefix in it.
	 *
	 * Cached, because the substitution is the same on every request until either
	 * the prefix or the plugin changes — and both are in the key.
	 */
	private static function design(): string {
		$prefix = Settings::get( 'classPrefix' );
		$prefix = is_string( $prefix ) && '' !== $prefix ? $prefix : 'pterodocs';

		$key    = 'pterodocs_design_' . md5( $prefix . '|' . VERSION );
		$cached = get_transient( $key );

		if ( is_string( $cached ) && '' !== $cached ) {
			return $cached;
		}

		$css = (string) file_get_contents( PTERODOCS_DIR . 'assets/css/docs.css' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents

		// The prefix is a slug by the time pterodocs writes it, but this ends up
		// inside a stylesheet, so anything that is not one is refused rather
		// than substituted.
		if ( ! preg_match( '/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/', $prefix ) ) {
			$prefix = 'pterodocs';
		}

		$css = str_replace( '{p}', $prefix, $css );
		set_transient( $key, $css, WEEK_IN_SECONDS );

		return $css;
	}

	/**
	 * The settings, as custom properties.
	 *
	 * Only what the settings page controls is written here. Everything else is
	 * defined in the stylesheet in terms of the theme's own global-styles
	 * variables, so a theme's palette and spacing scale reach the documentation
	 * without passing through this plugin at all.
	 */
	private static function custom_properties(): string {
		$settings = Settings::all();

		$declarations = array();

		$gutter = Markup::length( $settings['gutter'] ?? '', '' );
		if ( '' !== $gutter ) {
			$declarations[] = '--pd-gutter:' . $gutter;
		}

		$measure = Markup::length( $settings['measure'] ?? '', '' );
		if ( '' !== $measure ) {
			$declarations[] = '--pd-measure:' . $measure;
		}

		if ( 'none' === ( $settings['sidebarAnimation'] ?? '' ) ) {
			$declarations[] = '--pd-motion:0ms';
		}

		if ( array() === $declarations ) {
			return '';
		}

		return ':root{' . implode( ';', $declarations ) . ';}';
	}

	/**
	 * Extend the core blocks pterodocs uses with the plugin's own settings.
	 *
	 * No block type is registered: this adds attributes and an inspector panel
	 * to blocks WordPress already has, which is what keeps the stored content
	 * ordinary core markup.
	 */
	public static function editor(): void {
		if ( ! self::editing_documentation() ) {
			return;
		}

		wp_enqueue_script(
			'pterodocs-editor',
			PTERODOCS_URL . 'assets/js/editor.js',
			array( 'wp-blocks', 'wp-hooks', 'wp-element', 'wp-components', 'wp-block-editor', 'wp-compose', 'wp-core-data', 'wp-i18n' ),
			VERSION,
			true
		);
		wp_set_script_translations( 'pterodocs-editor', 'pterodocs', PTERODOCS_DIR . 'languages' );

		wp_enqueue_style( 'pterodocs-editor', PTERODOCS_URL . 'assets/css/editor.css', array(), VERSION );
	}
}
