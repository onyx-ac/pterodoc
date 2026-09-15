<?php
/**
 * Plugin Name:       pterodocs
 * Plugin URI:        https://github.com/onyx-ac/pterodocs
 * Description:       Turns documentation published by pterodocs into a proper documentation experience: a collapsible sidebar, highlighted code with a copy button, scrolling tables and a full-width layout — all styled from your theme's own palette.
 * Version:           0.5.0
 * Requires at least: 6.5
 * Requires PHP:      8.0
 * Author:            Onyx
 * Author URI:        https://onyx.ac
 * License:           CC-BY-SA-4.0
 * License URI:       https://creativecommons.org/licenses/by-sa/4.0/
 * Text Domain:       pterodocs
 * Domain Path:       /languages
 *
 * @package pterodocs
 */

declare( strict_types = 1 );

namespace Pterodocs;

defined( 'ABSPATH' ) || exit;

const VERSION = '0.5.0';

define( 'PTERODOCS_FILE', __FILE__ );
define( 'PTERODOCS_DIR', plugin_dir_path( __FILE__ ) );
define( 'PTERODOCS_URL', plugin_dir_url( __FILE__ ) );

require_once PTERODOCS_DIR . 'inc/Settings.php';
require_once PTERODOCS_DIR . 'inc/Markup.php';
require_once PTERODOCS_DIR . 'inc/Prism.php';
require_once PTERODOCS_DIR . 'inc/Assets.php';
require_once PTERODOCS_DIR . 'inc/Render.php';
require_once PTERODOCS_DIR . 'inc/Llms.php';

/**
 * Wire the plugin up.
 *
 * Everything this plugin does is additive: it registers no block types and
 * rewrites no stored content. Deactivate it and the pages it was styling are
 * still readable, because the markup underneath is ordinary core blocks.
 */
function bootstrap(): void {
	Settings::init();
	Assets::init();
	Render::init();
	Llms::init();

	// Rewrite rules only exist once they have been flushed, and flushing is
	// expensive enough that it belongs on activation rather than on every load.
	register_activation_hook( PTERODOCS_FILE, array( Llms::class, 'activate' ) );
	register_deactivation_hook( PTERODOCS_FILE, array( Llms::class, 'deactivate' ) );

	add_action(
		'init',
		static function (): void {
			load_plugin_textdomain( 'pterodocs', false, dirname( plugin_basename( PTERODOCS_FILE ) ) . '/languages' );
		}
	);
}

bootstrap();
