<?php
/**
 * Site-wide defaults.
 *
 * One option, exposed over REST, so the settings page and the block inspector
 * read the same source and a block can say "inherit" by simply not carrying an
 * attribute. The resolution order everywhere is: block attribute, then this,
 * then the built-in default.
 *
 * @package pterodocs
 */

declare( strict_types = 1 );

namespace Pterodocs;

defined( 'ABSPATH' ) || exit;

/**
 * Reads and registers the plugin's options.
 */
final class Settings {

	/** Option name. */
	public const OPTION = 'pterodocs_settings';

	/** Menu slug, which also names the admin page's hook suffix. */
	public const SLUG = 'pterodocs';

	/**
	 * The built-in defaults.
	 *
	 * `classPrefix` matters more than it looks: pterodocs's own `render.classPrefix`
	 * is configurable, so a site synced with a different prefix is styled by
	 * changing this rather than by re-syncing every page.
	 *
	 * @return array<string, mixed>
	 */
	public static function defaults(): array {
		return array(
			'classPrefix'          => 'pterodocs',

			'width'                => 'full',
			'gutter'               => '',
			'measure'              => '',
			'flushCode'            => true,
			'flushTables'          => true,

			'sidebarCollapsible'   => true,
			'sidebarCollapsedDepth' => 1,
			'sidebarSticky'        => true,
			'sidebarMaxHeight'     => 'calc(100vh - 6rem)',
			'sidebarStickyTop'     => '2rem',
			'sidebarMobile'        => 'bottom-sheet',
			'sidebarAnimation'     => 'slide',
			'scrollModel'          => 'page',

			'syntaxHighlight'      => true,
			'codeCopy'             => true,
			'codeLineNumbers'      => 'auto',
			'codeWrap'             => false,

			'tableScroll'          => true,

			'breadcrumbSeparator'  => '',
			'breadcrumbSchema'     => true,

			'colorScheme'          => 'auto',
		);
	}

	/**
	 * The REST schema, which is also what sanitises a write.
	 *
	 * @return array<string, mixed>
	 */
	private static function schema(): array {
		$enum = static fn( array $values ): array => array( 'type' => 'string', 'enum' => $values );

		return array(
			'type'       => 'object',
			'properties' => array(
				'classPrefix'           => array( 'type' => 'string' ),
				'width'                 => $enum( array( 'full', 'wide', 'content' ) ),
				'gutter'                => array( 'type' => 'string' ),
				'measure'               => array( 'type' => 'string' ),
				'flushCode'             => array( 'type' => 'boolean' ),
				'flushTables'           => array( 'type' => 'boolean' ),
				'sidebarCollapsible'    => array( 'type' => 'boolean' ),
				'sidebarCollapsedDepth' => array( 'type' => 'integer', 'minimum' => 0, 'maximum' => 6 ),
				'sidebarSticky'         => array( 'type' => 'boolean' ),
				'sidebarMaxHeight'      => array( 'type' => 'string' ),
				'sidebarStickyTop'      => array( 'type' => 'string' ),
				'sidebarMobile'         => $enum( array( 'inline', 'bottom-sheet', 'drawer', 'hidden' ) ),
				'sidebarAnimation'      => $enum( array( 'none', 'fade', 'slide' ) ),
				'scrollModel'           => $enum( array( 'page', 'panes' ) ),
				'syntaxHighlight'       => array( 'type' => 'boolean' ),
				'codeCopy'              => array( 'type' => 'boolean' ),
				'codeLineNumbers'       => $enum( array( 'off', 'auto', 'always' ) ),
				'codeWrap'              => array( 'type' => 'boolean' ),
				'tableScroll'           => array( 'type' => 'boolean' ),
				'breadcrumbSeparator'   => array( 'type' => 'string' ),
				'breadcrumbSchema'      => array( 'type' => 'boolean' ),
				'colorScheme'           => $enum( array( 'auto', 'light', 'dark' ) ),
			),
			'additionalProperties' => false,
		);
	}

	/**
	 * Register the option and the admin page.
	 */
	public static function init(): void {
		add_action( 'init', array( self::class, 'register' ) );
		add_action( 'admin_menu', array( self::class, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( self::class, 'admin_assets' ) );
	}

	/**
	 * Register the option, in REST as well, so the block editor can read it.
	 */
	public static function register(): void {
		register_setting(
			'options',
			self::OPTION,
			array(
				'type'         => 'object',
				'default'      => self::defaults(),
				'show_in_rest' => array( 'schema' => self::schema() ),
			)
		);
	}

	/**
	 * All settings, defaults filled in.
	 *
	 * @return array<string, mixed>
	 */
	public static function all(): array {
		$stored = get_option( self::OPTION );

		return is_array( $stored )
			? array_merge( self::defaults(), $stored )
			: self::defaults();
	}

	/**
	 * One setting.
	 *
	 * @param string $key Setting name.
	 * @return mixed The stored value, or the default.
	 */
	public static function get( string $key ) {
		$all = self::all();

		return $all[ $key ] ?? null;
	}

	/**
	 * Resolve a setting a block may have overridden.
	 *
	 * An absent attribute means inherit — which is why the editor stores nothing
	 * at all for a control left on its default.
	 *
	 * @param array<string, mixed> $attrs Parsed block attributes.
	 * @param string               $name  Attribute name.
	 * @param string               $key   Setting to fall back to.
	 * @return mixed
	 */
	public static function resolve( array $attrs, string $name, string $key ) {
		return array_key_exists( $name, $attrs ) && null !== $attrs[ $name ]
			? $attrs[ $name ]
			: self::get( $key );
	}

	/**
	 * Add the settings page under Settings.
	 */
	public static function menu(): void {
		add_options_page(
			__( 'pterodocs', 'pterodocs' ),
			__( 'pterodocs', 'pterodocs' ),
			'manage_options',
			self::SLUG,
			static function (): void {
				if ( ! current_user_can( 'manage_options' ) ) {
					return;
				}
				echo '<div class="wrap"><div id="pterodocs-settings"></div></div>';
			}
		);
	}

	/**
	 * Load the settings page.
	 *
	 * @param string $hook The admin page being rendered.
	 */
	public static function admin_assets( string $hook ): void {
		// `add_options_page` builds this from the menu slug, so the two are one
		// string in two places. Getting it wrong costs nothing at load time and
		// renders an empty settings page.
		if ( 'settings_page_' . self::SLUG !== $hook ) {
			return;
		}

		wp_enqueue_script(
			'pterodocs-settings',
			PTERODOCS_URL . 'assets/js/settings.js',
			array( 'wp-element', 'wp-components', 'wp-core-data', 'wp-data', 'wp-api-fetch', 'wp-i18n' ),
			VERSION,
			true
		);
		wp_set_script_translations( 'pterodocs-settings', 'pterodocs', PTERODOCS_DIR . 'languages' );
		wp_enqueue_style( 'wp-components' );
	}
}
