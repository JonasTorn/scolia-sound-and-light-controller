<?php
/**
 * Plugin Name: Dart Scoreboard Endpoint
 * Description: Receives scoreboard stats pushed by the Scolia light controller (WebsitePublisher) and serves them as JSON.
 *
 * Install: drop in wp-content/mu-plugins/ (or paste into WPCodeBox as a PHP snippet, without the header).
 * Then add the shared token to wp-config.php — same value as scoreboard.website.token in config.secrets.json:
 *
 *   define('DART_SCOREBOARD_TOKEN', '...');
 *
 * Endpoints:
 *   POST /wp-json/dart/v1/scoreboard   — header X-Scoreboard-Token, body { stats, todayStats, lastUpdated }
 *   GET  /wp-json/dart/v1/scoreboard   — public, returns the last pushed payload
 *
 * The POST URL is what goes in config.secrets.json → scoreboard.website.url.
 */

if (!defined('ABSPATH')) exit;

const DART_SCOREBOARD_OPTION = 'dart_scoreboard_stats';
const DART_SCOREBOARD_MAX_BYTES = 512 * 1024;

add_action('rest_api_init', function () {
	register_rest_route('dart/v1', '/scoreboard', [
		[
			'methods'             => 'POST',
			'callback'            => 'dart_scoreboard_receive',
			'permission_callback' => 'dart_scoreboard_check_token',
		],
		[
			'methods'             => 'GET',
			'callback'            => 'dart_scoreboard_read',
			'permission_callback' => '__return_true',
		],
	]);
});

function dart_scoreboard_check_token(WP_REST_Request $request) {
	if (!defined('DART_SCOREBOARD_TOKEN') || DART_SCOREBOARD_TOKEN === '') {
		return new WP_Error('dart_not_configured', 'DART_SCOREBOARD_TOKEN is not set', ['status' => 500]);
	}
	$token = (string) $request->get_header('X-Scoreboard-Token');
	if (!hash_equals(DART_SCOREBOARD_TOKEN, $token)) {
		return new WP_Error('dart_forbidden', 'Invalid token', ['status' => 401]);
	}
	return true;
}

function dart_scoreboard_receive(WP_REST_Request $request) {
	if (strlen($request->get_body()) > DART_SCOREBOARD_MAX_BYTES) {
		return new WP_Error('dart_too_large', 'Payload too large', ['status' => 413]);
	}
	$data = $request->get_json_params();
	if (!is_array($data) || !isset($data['stats']) || !is_array($data['stats'])) {
		return new WP_Error('dart_bad_payload', 'Expected { stats: [...] }', ['status' => 400]);
	}

	update_option(DART_SCOREBOARD_OPTION, [
		'stats'       => $data['stats'],
		'todayStats'  => is_array($data['todayStats'] ?? null) ? $data['todayStats'] : [],
		'lastUpdated' => sanitize_text_field($data['lastUpdated'] ?? gmdate('c')),
	], false);

	return ['ok' => true, 'players' => count($data['stats'])];
}

function dart_scoreboard_read() {
	$data = get_option(DART_SCOREBOARD_OPTION, ['stats' => [], 'todayStats' => [], 'lastUpdated' => null]);
	$response = rest_ensure_response($data);
	$response->header('Cache-Control', 'public, max-age=30');
	return $response;
}
