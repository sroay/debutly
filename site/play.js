// Plays the run log once, line by line, unless the visitor prefers less motion.
(function () {
  var log = document.querySelector("[data-play]");
  if (!log || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var lines = log.querySelectorAll("li");
  log.classList.add("playing");
  lines.forEach(function (line, i) {
    setTimeout(function () {
      line.classList.add("shown");
    }, 500 + i * 650);
  });
})();
