/*
 * Weather icons: small hand-made SVGs (bundled here, no icon CDN), optionally animated with CSS
 * (see .wx-anim in style.css). Gradients live in the hidden <svg class="svg-defs"> in index.html.
 * Plain ES5 for old Android WebViews.
 *   WxIcons.kind(icon, main)  -> "clear-day" | "clear-night" | "partly-day" | "partly-night" |
 *                                "cloudy" | "overcast" | "rain" | "drizzle" | "storm" | "snow" | "fog"
 *   WxIcons.theme(kind)       -> background theme name (clear-day, clear-night, cloudy-day,
 *                                cloudy-night, rain, storm, snow, fog)
 *   WxIcons.svg(kind, animate) -> SVG markup string
 */
(function () {
  "use strict";

  function cloud(fill, dx, dy, s) {
    var t = (dx || dy || s) ? ' transform="translate(' + (dx || 0) + ' ' + (dy || 0) + ') scale(' + (s || 1) + ')"' : "";
    return '<g class="cloud" fill="url(#' + fill + ')"' + t + '>' +
      '<circle cx="22" cy="36" r="9"/><circle cx="34" cy="29" r="12.5"/><circle cx="45.5" cy="37" r="8"/>' +
      '<rect x="22" y="33" width="24" height="12" /></g>';
  }
  function sun(cx, cy, s) {
    var rays = "";
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4, c = Math.cos(a), n = Math.sin(a);
      rays += '<line x1="' + (32 + c * 17).toFixed(1) + '" y1="' + (32 + n * 17).toFixed(1) +
        '" x2="' + (32 + c * 23).toFixed(1) + '" y2="' + (32 + n * 23).toFixed(1) + '"/>';
    }
    return '<g transform="translate(' + (cx - 32 * s) + ' ' + (cy - 32 * s) + ') scale(' + s + ')">' +
      '<g class="rays" stroke="#ffc83d" stroke-width="3.2" stroke-linecap="round">' + rays + '</g>' +
      '<circle class="sun-core" cx="32" cy="32" r="12" fill="url(#wxg-sun)"/></g>';
  }
  function moon(cx, cy, s) {
    return '<g transform="translate(' + (cx - 32 * s) + ' ' + (cy - 32 * s) + ') scale(' + s + ')">' +
      '<path class="moon" fill="url(#wxg-moon)" d="M38.5 14.5A17.5 17.5 0 1 0 49.5 44 15 15 0 0 1 38.5 14.5z"/>' +
      '<g class="stars" fill="#fff"><circle class="star" cx="50" cy="16" r="1.4"/><circle class="star s2" cx="56" cy="27" r="1"/></g></g>';
  }
  function drops(n, color, cls) {
    var out = '<g class="' + cls + '" stroke="' + color + '" stroke-width="2.6" stroke-linecap="round">';
    var xs = n === 2 ? [27, 39] : [24, 33, 42];
    for (var i = 0; i < xs.length; i++) {
      out += '<line style="animation-delay:' + (i * 0.35).toFixed(2) + 's" x1="' + xs[i] + '" y1="49" x2="' + (xs[i] - 2) + '" y2="55"/>';
    }
    return out + "</g>";
  }
  function flakes() {
    var out = '<g class="flakes" fill="#fff">', xs = [24, 33, 42];
    for (var i = 0; i < xs.length; i++) out += '<circle style="animation-delay:' + (i * 0.6) + 's" cx="' + xs[i] + '" cy="52" r="2.2"/>';
    return out + "</g>";
  }

  var BUILD = {
    "clear-day": function () { return sun(32, 32, 1); },
    "clear-night": function () { return moon(32, 32, 1); },
    "partly-day": function () { return sun(24, 24, 0.72) + cloud("wxg-cloud", 6, 6, 0.92); },
    "partly-night": function () { return moon(26, 24, 0.66) + cloud("wxg-cloud", 6, 6, 0.92); },
    "cloudy": function () { return cloud("wxg-cloud", 0, 0, 1); },
    "overcast": function () { return cloud("wxg-cloud-dark", -6, -6, 0.9) + cloud("wxg-cloud", 4, 2, 0.95); },
    "rain": function () { return cloud("wxg-cloud-dark", 0, -2, 1) + drops(3, "#5ab4ff", "drops"); },
    "drizzle": function () { return cloud("wxg-cloud", 0, -2, 1) + drops(2, "#8fd0ff", "drops"); },
    "storm": function () {
      return cloud("wxg-cloud-dark", 0, -2, 1) +
        '<path class="bolt" fill="url(#wxg-bolt)" d="M35 40 27 52h6l-3 9 10-13h-6l4-8z"/>';
    },
    "snow": function () { return cloud("wxg-cloud", 0, -2, 1) + flakes(); },
    "fog": function () {
      return cloud("wxg-cloud", 0, -4, 0.95) +
        '<g class="fogs" stroke="#dbe4ee" stroke-width="3" stroke-linecap="round">' +
        '<line x1="16" y1="49" x2="44" y2="49"/><line class="f2" x1="22" y1="55" x2="50" y2="55"/></g>';
    }
  };

  function kind(icon, main) {
    var code = String(icon || ""), night = code.charAt(2) === "n", n = code.slice(0, 2);
    if (n === "01") return night ? "clear-night" : "clear-day";
    if (n === "02") return night ? "partly-night" : "partly-day";
    if (n === "03") return "cloudy";
    if (n === "04") return "overcast";
    if (n === "09") return "drizzle";
    if (n === "10") return "rain";
    if (n === "11") return "storm";
    if (n === "13") return "snow";
    if (n === "50") return "fog";
    var m = String(main || "").toLowerCase();
    if (m === "clear") return "clear-day";
    if (m === "clouds") return "cloudy";
    if (m === "rain") return "rain";
    if (m === "drizzle") return "drizzle";
    if (m === "thunderstorm") return "storm";
    if (m === "snow") return "snow";
    if (m) return "fog";
    return "cloudy";
  }

  function theme(k, isNight) {
    if (k === "clear-day" || k === "partly-day") return isNight ? "clear-night" : "clear-day";
    if (k === "clear-night" || k === "partly-night") return "clear-night";
    if (k === "cloudy" || k === "overcast") return isNight ? "cloudy-night" : "cloudy-day";
    if (k === "rain" || k === "drizzle") return "rain";
    return k === "storm" || k === "snow" || k === "fog" ? k : "cloudy-day";
  }

  function svg(k, animate) {
    var b = BUILD[k] || BUILD.cloudy;
    return '<svg class="wx-svg wx-' + k + (animate ? " wx-anim" : "") + '" viewBox="0 0 64 64" aria-hidden="true" focusable="false">' + b() + "</svg>";
  }

  window.WxIcons = { kind: kind, theme: theme, svg: svg, kinds: function () { var a = []; for (var k in BUILD) if (BUILD.hasOwnProperty(k)) a.push(k); return a; } };
})();
