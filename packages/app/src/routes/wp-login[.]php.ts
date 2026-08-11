import { createFileRoute } from "@tanstack/react-router";

// A honeypot for the WordPress scanners that hammer this origin all day long.
// GET serves a login form that looks like wp-login.php, POST always "succeeds"
// and drops the visitor on a fake wp-admin that turns into an Everr ad.
//
// The POST body is never read, parsed, stored, or logged. Scanners replay
// credential lists that belong to real people on other sites, and we want no
// part of that. The automatic server span (url.path, status) is all we keep.

const LANDING_URL = "https://everr.dev";

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Nothing here is real, so keep it out of caches and out of search.
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en-US">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Log In &lsaquo; Everr &#8212; WordPress</title>
<style>
  body { background: #f0f0f1; color: #3c434a; font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; }
  #login { width: 320px; margin: auto; padding: 6% 0 40px; }
  h1 a { background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%233c434a'%3E%3Cpath d='M12 2a10 10 0 100 20 10 10 0 000-20zm0 1.5a8.5 8.5 0 018.5 8.5 8.5 8.5 0 01-8.5 8.5A8.5 8.5 0 013.5 12 8.5 8.5 0 0112 3.5z'/%3E%3C/svg%3E") center no-repeat; background-size: 84px; display: block; height: 84px; text-indent: -9999px; margin: 0 auto 25px; }
  form { background: #fff; border: 1px solid #c3c4c7; box-shadow: 0 1px 3px rgba(0,0,0,.04); padding: 26px 24px 34px; margin-top: 20px; }
  label { display: block; margin-bottom: 3px; font-size: 14px; }
  input[type=text], input[type=password] { width: 100%; box-sizing: border-box; padding: 6px 8px; margin: 0 0 16px; border: 1px solid #8c8f94; border-radius: 3px; font-size: 16px; }
  .button { background: #2271b1; border: 1px solid #2271b1; border-radius: 3px; color: #fff; padding: 6px 14px; font-size: 13px; cursor: pointer; float: right; }
  .forgetmenot { float: left; padding-top: 6px; }
  .forgetmenot label { display: inline; font-size: 13px; }
  .submit::after { content: ""; display: block; clear: both; }
  #nav, #backtoblog { margin: 16px 0 0; padding: 0 24px; text-align: center; font-size: 13px; }
  a { color: #50575e; text-decoration: none; }
  a:hover { color: #135e96; }
</style>
</head>
<body class="login js login-action-login wp-core-ui locale-en-us">
<div id="login">
  <h1><a href="${LANDING_URL}">Everr</a></h1>
  <form name="loginform" id="loginform" action="/wp-login.php" method="post">
    <p>
      <label for="user_login">Username or Email Address</label>
      <input type="text" name="log" id="user_login" class="input" value="" size="20" autocapitalize="off" autocomplete="username" />
    </p>
    <div class="user-pass-wrap">
      <label for="user_pass">Password</label>
      <input type="password" name="pwd" id="user_pass" class="input" value="" size="20" autocomplete="current-password" />
    </div>
    <p class="forgetmenot"><input name="rememberme" type="checkbox" id="rememberme" value="forever" /> <label for="rememberme">Remember Me</label></p>
    <p class="submit">
      <input type="submit" name="wp-submit" id="wp-submit" class="button button-primary" value="Log In" />
    </p>
  </form>
  <p id="nav"><a href="/wp-login.php">Lost your password?</a></p>
  <p id="backtoblog"><a href="${LANDING_URL}">&larr; Go to Everr</a></p>
</div>
</body>
</html>`;

const BREACH_PAGE = `<!DOCTYPE html>
<html lang="en-US">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Dashboard &lsaquo; Everr &#8212; WordPress</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #1d2327; color: #f0f0f1; font: 14px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; }
  #adminmenu { position: fixed; inset: 0 auto 0 0; width: 160px; background: #1d2327; border-right: 1px solid #2c3338; padding-top: 8px; }
  #adminmenu a { display: block; padding: 8px 12px; color: #c3c4c7; text-decoration: none; font-size: 13px; }
  #adminmenu a.current { background: #2271b1; color: #fff; }
  #wpbody { margin-left: 160px; padding: 0 20px 40px; }
  #wpadminbar { background: #1d2327; border-bottom: 1px solid #2c3338; padding: 8px 20px; margin: 0 -20px 20px; font-size: 13px; color: #c3c4c7; }
  h1 { font-size: 23px; font-weight: 400; margin: 20px 0; }
  .promo { background: linear-gradient(135deg, #fff8c4 0%, #ffe66d 100%); color: #1d2327; border: none; padding: 40px; text-align: center; border-radius: 8px; margin: 24px 0; }
  .promo .lemon { font-size: 56px; line-height: 1; }
  .promo h2 { font-size: 28px; line-height: 1.25; margin: 16px auto 24px; max-width: 34ch; color: #1d2327; text-transform: none; letter-spacing: normal; font-weight: 700; }
  .cta { display: inline-block; background: #1d2327; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 15px; }
  .cta:hover { background: #2271b1; }
  footer { color: #a7aaad; font-size: 12px; border-top: 1px solid #3c434a; padding-top: 12px; }
</style>
</head>
<body class="wp-admin">
<nav id="adminmenu">
  <a href="/wp-login.php" class="current">Dashboard</a>
  <a href="/wp-login.php">Posts</a>
  <a href="/wp-login.php">Media</a>
  <a href="/wp-login.php">Plugins</a>
  <a href="/wp-login.php">Users</a>
  <a href="/wp-login.php">Settings</a>
</nav>
<div id="wpbody">
  <div id="wpadminbar">Howdy, <strong>admin</strong> &nbsp;|&nbsp; Everr &nbsp;|&nbsp; 0 updates</div>
  <h1>Dashboard</h1>

  <div class="promo">
    <div class="lemon">&#127819;</div>
    <h2>Life is giving you lemons? Move to the best observability platform Everr!</h2>
    <a class="cta" href="${LANDING_URL}">everr.dev</a>
  </div>

  <footer>Thank you for creating with WordPress.</footer>
</div>
</body>
</html>`;

export const Route = createFileRoute("/wp-login.php")({
  server: {
    handlers: {
      GET: async () => html(LOGIN_PAGE),
      POST: async () => html(BREACH_PAGE),
    },
  },
});
