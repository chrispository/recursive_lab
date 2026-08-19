/**
 * Composing orb. MIT-derived composing/ribbon renderer from Jakub Antalik's
 * thinking-orbs (https://github.com/Jakubantalik/thinking-orbs). It starts on
 * every HTMX replacement; detached canvases stop themselves on their next frame.
 */
(function () {
  'use strict';

  function startThinkingOrb(canvas) {
    if (canvas.dataset.orbStarted) return;
    canvas.dataset.orbStarted = 'true';

    var size = 64;
    var ratio = Math.min(2, window.devicePixelRatio || 1);
    var context = canvas.getContext('2d');
    if (!context) return;
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);

    function fibDir(index, total) {
      var angle = index * Math.PI * (3 - Math.sqrt(5));
      var y = 1 - 2 * (index + 0.5) / total;
      var radius = Math.sqrt(1 - y * y);
      return [radius * Math.cos(angle), y, radius * Math.sin(angle)];
    }

    function project(x, y, z, tilt) {
      return [size / 2 + x, size / 2 - (y * Math.cos(tilt) - z * Math.sin(tilt)), y * Math.sin(tilt) + z * Math.cos(tilt)];
    }

    function frame(seconds) {
      var t = seconds * 2.34;
      var radius = size * 0.39;
      var tilt = 0.3;
      var dots = [];
      var radiusScale = Math.pow(size / 300, 0.6);
      var lanes = 12;
      var segments = 44;
      for (var ghost = 0; ghost < 38; ghost += 1) {
        var direction = fibDir(ghost, 38);
        var background = project(direction[0] * radius, direction[1] * radius, direction[2] * radius, tilt);
        var backgroundDepth = (background[2] / radius + 1) / 2;
        dots.push([background[0], background[1], background[2], 0.8 * radiusScale, 0.78, 0.1 + 0.22 * backgroundDepth]);
      }
      var tiltAngle = 0.55;
      var vy = Math.cos(tiltAngle);
      var vz = Math.sin(tiltAngle);
      var ny = -Math.sin(tiltAngle);
      var nz = Math.cos(tiltAngle);
      for (var lane = 0; lane < lanes; lane += 1) {
        var offsetBase = (lane - (lanes - 1) / 2) * 0.075;
        var edge = Math.abs(lane - (lanes - 1) / 2) / ((lanes - 1) / 2);
        for (var segment = 0; segment < segments; segment += 1) {
          var angle = segment / segments * Math.PI * 2;
          var wobble = 0.16 * Math.sin(angle * 3 - t * 1.7 + lane * 0.22) + 0.07 * Math.sin(angle * 5 + t * 1.1);
          var offset = offsetBase + wobble;
          var x = Math.cos(angle);
          var y = vy * Math.sin(angle) + ny * offset;
          var z = vz * Math.sin(angle) + nz * offset;
          var length = Math.hypot(x, y, z);
          var point = project(x / length * radius, y / length * radius, z / length * radius, tilt);
          var depth = (point[2] / radius + 1) / 2;
          dots.push([point[0], point[1], point[2], (0.935 + 1.445 * depth) * (1 - 0.25 * edge) * radiusScale, 0.52 - 0.44 * depth + 0.18 * edge, 0.4 + 0.6 * depth]);
        }
      }
      return dots.sort(function (a, b) { return a[2] - b[2]; });
    }

    function draw(seconds, animate) {
      var dark = document.documentElement.dataset.theme === 'dark';
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, size, size);
      frame(seconds).forEach(function (dot) {
        var ink = Math.round((dark ? 1 - dot[4] : dot[4]) * 255);
        context.fillStyle = 'rgba(' + ink + ',' + ink + ',' + ink + ',' + dot[5] + ')';
        context.beginPath();
        context.arc(dot[0], dot[1], Math.max(0.3, dot[3]), 0, Math.PI * 2);
        context.fill();
      });
      if (animate) {
        window.requestAnimationFrame(function (now) {
          if (!canvas.isConnected) return;
          draw(now / 1000, true);
        });
      }
    }

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw(0.6, false);
      return;
    }
    window.requestAnimationFrame(function (now) { draw(now / 1000, true); });
  }

  function startThinkingOrbs() {
    document.querySelectorAll('[data-thinking-orb]').forEach(startThinkingOrb);
  }

  document.addEventListener('htmx:afterSwap', startThinkingOrbs);
  startThinkingOrbs();
})();
