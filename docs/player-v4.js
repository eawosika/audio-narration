(function() {
  var API = 'https://audio-narration-production.up.railway.app';
  var slug = window.location.pathname.split('/').filter(Boolean).pop();

  // ── Inject HTML markup ──
  var playerHTML = '<div id="narration-player" style="display:none;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Arial,sans-serif;background:#e8e3d5;border:2px solid #111;border-radius:14px;padding:16px 20px;margin-top:24px;margin-bottom:32px;">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'
    + '<div style="display:flex;align-items:center;gap:6px;"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1a2 2 0 0 1 2 2v5a2 2 0 1 1-4 0V3a2 2 0 0 1 2-2z" fill="#555"/><path d="M4 7a4 4 0 0 0 8 0" stroke="#555" stroke-width="1.5" stroke-linecap="round"/><path d="M8 13v2" stroke="#555" stroke-width="1.5" stroke-linecap="round"/></svg><span style="font-size:13px;font-weight:600;color:#555;">Listen to this article</span></div>'
    + '<div id="np-external-btns" style="display:flex;align-items:center;gap:16px;">'
    + '<div class="np-tooltip-wrap"><a id="np-spotify-btn" href="#" target="_blank" rel="noopener" style="display:none;color:#555;transition:color 0.15s;" onmouseenter="this.style.color=\'#1DB954\'" onmouseleave="this.style.color=\'#555\'"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg></a><span class="np-tooltip">Play on Spotify</span></div>'
    + '<div class="np-tooltip-wrap"><button id="np-download-btn" style="display:none;background:none;border:none;padding:0;cursor:pointer;color:#555;transition:color 0.15s;" onmouseenter="this.style.color=\'#111\'" onmouseleave="this.style.color=\'#555\'"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v10"/><path d="M5 9l4 4 4-4"/><path d="M3 15h12"/></svg></button><span class="np-tooltip">Download article audio</span></div>'
    + '<div class="np-tooltip-wrap" id="np-audio-share-wrap" style="display:none;"><button id="np-audio-share-btn" style="background:none;border:none;padding:0;cursor:pointer;color:#555;transition:color 0.15s;" onmouseenter="this.style.color=\'#111\'" onmouseleave="this.style.color=\'#555\'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button><span class="np-tooltip">Share audio</span><div id="np-audio-share-menu" class="np-share-menu" style="right:0;top:calc(100% + 8px);"></div></div>'
    + '</div></div>'
    + '<div style="display:flex;align-items:center;gap:14px;">'
    + '<button id="np-play" style="width:44px;height:44px;border-radius:50%;background:#111;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.15s;" onmouseenter="this.style.background=\'#222\'" onmouseleave="this.style.background=\'#111\'">'
    + '<svg id="np-icon-play" width="16" height="16" viewBox="0 0 18 18" fill="#fff"><path d="M5 2.5v13l10-6.5z"/></svg>'
    + '<svg id="np-icon-pause" width="16" height="16" viewBox="0 0 18 18" fill="#fff" style="display:none;"><rect x="4" y="3" width="3.5" height="12" rx="1"/><rect x="10.5" y="3" width="3.5" height="12" rx="1"/></svg>'
    + '<svg id="np-icon-loading" width="18" height="18" viewBox="0 0 20 20" style="display:none;animation:np-spin 0.9s linear infinite;"><circle cx="10" cy="10" r="8" stroke="#777" stroke-width="2" fill="none" stroke-dasharray="38 18"/></svg>'
    + '</button>'
    + '<div class="np-tooltip-wrap"><button id="np-restart" style="width:28px;height:28px;border-radius:50%;background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#555;transition:color 0.15s;padding:0;" onmouseenter="this.style.color=\'#111\'" onmouseleave="this.style.color=\'#555\'"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg></button><span class="np-tooltip">Restart from beginning</span></div>'
    + '<div style="flex:1;min-width:0;"><div id="np-track" style="height:5px;border-radius:3px;background:#d8d2c3;position:relative;margin-bottom:7px;cursor:pointer;"><div id="np-fill" style="height:100%;border-radius:3px;background:#111;width:0%;transition:width 0.1s linear;"></div><div id="np-thumb" style="position:absolute;top:-5px;left:-7px;width:14px;height:14px;border-radius:50%;background:#111;border:2px solid #e8e3d5;box-shadow:0 1px 3px rgba(0,0,0,0.15);transition:left 0.1s linear;display:none;"></div></div>'
    + '<div style="display:flex;justify-content:space-between;align-items:center;"><span id="np-time" style="color:#777;font-size:12px;">0:00 / 0:00</span><div id="np-speed-wrap" style="position:relative;"><button id="np-speed-btn" style="background:#d8d2c3;border:1px solid #cec7b8;color:#555;font-size:12px;font-weight:600;padding:2px 8px;border-radius:6px;cursor:pointer;">1x</button><div id="np-speed-menu" style="display:none;position:absolute;bottom:28px;right:0;background:#f4f1e6;border:1px solid #d8d2c3;border-radius:8px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,0.08);"></div></div></div>'
    + '</div></div></div>'
    + '<audio id="np-audio" preload="metadata"></audio>';

  var miniHTML = '<div id="np-mini-player">'
    + '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;"><path d="M8 1a2 2 0 0 1 2 2v5a2 2 0 1 1-4 0V3a2 2 0 0 1 2-2z" fill="#555"/><path d="M4 7a4 4 0 0 0 8 0" stroke="#555" stroke-width="1.5" stroke-linecap="round"/><path d="M8 13v2" stroke="#555" stroke-width="1.5" stroke-linecap="round"/></svg>'
    + '<button id="np-mini-play" style="width:36px;height:36px;border-radius:50%;background:#111;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.15s;" onmouseenter="this.style.background=\'#222\'" onmouseleave="this.style.background=\'#111\'">'
    + '<svg id="np-mini-icon-play" width="14" height="14" viewBox="0 0 18 18" fill="#fff"><path d="M5 2.5v13l10-6.5z"/></svg>'
    + '<svg id="np-mini-icon-pause" width="14" height="14" viewBox="0 0 18 18" fill="#fff" style="display:none;"><rect x="4" y="3" width="3.5" height="12" rx="1"/><rect x="10.5" y="3" width="3.5" height="12" rx="1"/></svg>'
    + '</button>'
    + '<button id="np-mini-restart" style="width:24px;height:24px;border-radius:50%;background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#555;transition:color 0.15s;padding:0;" onmouseenter="this.style.color=\'#111\'" onmouseleave="this.style.color=\'#555\'"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg></button>'
    + '<div id="np-mini-progress-track"><div id="np-mini-progress-fill"></div><div id="np-mini-progress-thumb"></div></div>'
    + '<button id="np-mini-speed" style="background:none;border:1px solid #cec7b8;color:#555;font-size:10px;font-weight:600;padding:2px 6px;border-radius:5px;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;white-space:nowrap;">1x</button>'
    + '<span id="np-mini-time" style="font-size:10px;color:#555;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;white-space:nowrap;">0:00</span>'
    + '</div>';

  var mobileHTML = '<div id="np-mobile-bar">'
    + '<button id="np-mob-play" style="width:30px;height:30px;border-radius:50%;background:#111;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
    + '<svg id="np-mob-icon-play" width="12" height="12" viewBox="0 0 18 18" fill="#fff"><path d="M5 2.5v13l10-6.5z"/></svg>'
    + '<svg id="np-mob-icon-pause" width="12" height="12" viewBox="0 0 18 18" fill="#fff" style="display:none;"><rect x="4" y="3" width="3.5" height="12" rx="1"/><rect x="10.5" y="3" width="3.5" height="12" rx="1"/></svg>'
    + '</button>'
    + '<div id="np-mobile-bar-track"><div id="np-mobile-bar-fill"></div></div>'
    + '<span id="np-mob-time" style="font-size:11px;color:#555;white-space:nowrap;min-width:32px;text-align:right;">0:00</span>'
    + '<button id="np-mob-speed" style="background:none;border:1px solid #cec7b8;color:#555;font-size:10px;font-weight:600;padding:2px 5px;border-radius:4px;cursor:pointer;white-space:nowrap;flex-shrink:0;">1x</button>'
    + '<button id="np-mob-restart" style="width:24px;height:24px;background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#555;padding:0;"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg></button>'
    + '</div>';

  function inject() {
    if (document.getElementById('narration-player')) return;
    // Insert after the summary button, falling back to after h1
    var anchor = document.querySelector('.summary-button');
    if (!anchor) anchor = document.querySelector('h1');
    if (!anchor) return;
    var wrapper = document.createElement('div');
    wrapper.innerHTML = playerHTML + miniHTML + mobileHTML;
    anchor.parentNode.insertBefore(wrapper, anchor.nextSibling);
    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  function init() {
    var player = document.getElementById('narration-player');
    var audio = document.getElementById('np-audio');
    var playBtn = document.getElementById('np-play');
    var iconPlay = document.getElementById('np-icon-play');
    var iconPause = document.getElementById('np-icon-pause');
    var iconLoading = document.getElementById('np-icon-loading');
    var track = document.getElementById('np-track');
    var fill = document.getElementById('np-fill');
    var thumb = document.getElementById('np-thumb');
    var timeEl = document.getElementById('np-time');
    var speedBtn = document.getElementById('np-speed-btn');
    var speedMenu = document.getElementById('np-speed-menu');
    var spotifyBtn = document.getElementById('np-spotify-btn');
    var downloadBtn = document.getElementById('np-download-btn');
    var restartBtn = document.getElementById('np-restart');
    var speeds = [0.75, 1, 1.25, 1.5, 2];
    var currentSpeed = 1;
    var audioReady = false;

    window.npShared = { slug: slug, speeds: speeds, currentSpeed: currentSpeed, spotifyUrl: null };

    // ── Spotify ──
    function initSpotify(spotifyUrl) {
      if (!spotifyUrl) return;
      window.npShared.spotifyUrl = spotifyUrl;
      spotifyBtn.href = spotifyUrl;
      spotifyBtn.style.display = 'block';
      var audioShareWrap = document.getElementById('np-audio-share-wrap');
      var audioShareBtn = document.getElementById('np-audio-share-btn');
      var audioShareMenu = document.getElementById('np-audio-share-menu');
      audioShareWrap.style.display = 'block';
      var artTitle = (document.querySelector('h1') || {}).textContent || document.title;
      var spEnc = encodeURIComponent(spotifyUrl);
      var listenTweet = encodeURIComponent('🎧 Listen to "' + artTitle.trim() + '" by @RialoHQ on Spotify: ' + spotifyUrl);
      var listenEmailSub = encodeURIComponent('Listen to "' + artTitle.trim() + '" | Rialo');
      var listenEmailBody = encodeURIComponent('I thought you\'d enjoy listening to this:\n\n🎧 "' + artTitle.trim() + '" by Rialo\n\nListen on Spotify: ' + spotifyUrl + '\n\nRead the article: ' + window.location.href + '\n\nVisit Rialo: https://www.rialo.io');
      [{label:'X (Twitter)',icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',url:'https://twitter.com/intent/tweet?text='+listenTweet},
      {label:'LinkedIn',icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',url:'https://www.linkedin.com/sharing/share-offsite/?url='+spEnc},
      {label:'Reddit',icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>',url:'https://reddit.com/submit?url='+spEnc+'&title='+encodeURIComponent('🎧 '+artTitle.trim()+' | Rialo')},
      {label:'Email',icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4l-10 8L2 4"/></svg>',url:'mailto:?subject='+listenEmailSub+'&body='+listenEmailBody},
      {label:'Copy Spotify link',icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',action:'copy-spotify'}
      ].forEach(function(item) {
        var el;
        if (item.action === 'copy-spotify') {
          el = document.createElement('button');
          el.addEventListener('click', function(e) { e.stopPropagation(); navigator.clipboard.writeText(spotifyUrl).then(function() { el.querySelector('.np-share-label').textContent = 'Copied!'; setTimeout(function() { el.querySelector('.np-share-label').textContent = 'Copy Spotify link'; }, 1500); }); });
        } else { el = document.createElement('a'); el.href = item.url; el.target = '_blank'; el.rel = 'noopener'; }
        el.className = 'np-share-item';
        el.innerHTML = item.icon + '<span class="np-share-label">' + item.label + '</span>';
        audioShareMenu.appendChild(el);
      });
      audioShareBtn.addEventListener('click', function(e) { e.stopPropagation(); audioShareMenu.classList.toggle('open'); });
      document.addEventListener('click', function(e) { if (!audioShareWrap.contains(e.target)) audioShareMenu.classList.remove('open'); });
    }

    fetch(API + '/api/spotify/' + slug).then(function(r) { return r.json(); }).then(function(d) { if (d.url) initSpotify(d.url); }).catch(function() {});

    // ── Helpers ──
    function fmt(s) { var m = Math.floor(s / 60); var sec = Math.floor(s % 60); return m + ':' + (sec < 10 ? '0' : '') + sec; }
    function showIcon(w) { iconPlay.style.display = w === 'play' ? 'block' : 'none'; iconPause.style.display = w === 'pause' ? 'block' : 'none'; iconLoading.style.display = w === 'loading' ? 'block' : 'none'; }
    downloadBtn.addEventListener('click', function() { window.location.href = API + '/api/narration/' + slug + '/download'; });

    // ── Progress persistence ──
    var storageKey = 'np_resume_' + slug;
    function saveProgress() { if (audio.duration && audio.currentTime > 5) localStorage.setItem(storageKey, JSON.stringify({ time: audio.currentTime, duration: audio.duration, speed: currentSpeed, updated: Date.now() })); }
    function loadProgress() { try { var s = JSON.parse(localStorage.getItem(storageKey)); if (!s) return null; if (Date.now() - s.updated > 30*24*60*60*1000) { localStorage.removeItem(storageKey); return null; } return s; } catch(e) { return null; } }
    function clearProgress() { localStorage.removeItem(storageKey); }

    // ── Show player only if audio exists ──
    fetch(API + '/api/narration/' + slug).then(function(r) { return r.json(); }).then(function(data) {
      if (data.exists) {
        player.style.display = '';
        audio.src = data.url;
        audioReady = true;
        downloadBtn.style.display = 'block';
        var saved = loadProgress();
        if (saved && saved.time > 5) {
          var pct = saved.duration ? (saved.time / saved.duration) * 100 : 0;
          if (pct > 0 && pct < 100) { fill.style.width = pct + '%'; thumb.style.left = 'calc(' + pct + '% - 7px)'; thumb.style.display = 'block'; timeEl.textContent = fmt(saved.time) + ' / ' + (saved.duration ? fmt(saved.duration) : '0:00'); }
          if (saved.speed) { currentSpeed = saved.speed; audio.playbackRate = saved.speed; speedBtn.textContent = saved.speed + 'x'; window.npShared.currentSpeed = saved.speed; }
        }
      }
    }).catch(function() {});

    // ── Playback ──
    playBtn.addEventListener('click', function() { if (audio.paused) audio.play(); else audio.pause(); });
    audio.addEventListener('play', function() { showIcon('pause'); thumb.style.display = 'block'; });
    audio.addEventListener('pause', function() { showIcon('play'); saveProgress(); });
    audio.addEventListener('ended', function() { showIcon('play'); fill.style.width = '0%'; thumb.style.left = '-7px'; clearProgress(); });
    audio.addEventListener('loadedmetadata', function() {
      if (audio.duration === Infinity || isNaN(audio.duration)) { audio.currentTime = 1e101; audio.addEventListener('timeupdate', function fix() { audio.removeEventListener('timeupdate', fix); audio.currentTime = 0; }); }
      timeEl.textContent = fmt(0) + ' / ' + fmt(audio.duration);
      var saved = loadProgress();
      if (saved && saved.time > 5 && saved.time < audio.duration - 5) {
        audio.currentTime = saved.time;
        if (saved.speed) { currentSpeed = saved.speed; audio.playbackRate = saved.speed; speedBtn.textContent = saved.speed + 'x'; if (document.getElementById('np-mini-speed')) document.getElementById('np-mini-speed').textContent = saved.speed + 'x'; window.npShared.currentSpeed = saved.speed; }
        var pct = (saved.time / audio.duration) * 100; fill.style.width = pct + '%'; thumb.style.left = 'calc(' + pct + '% - 7px)'; thumb.style.display = 'block'; timeEl.textContent = fmt(saved.time) + ' / ' + fmt(audio.duration);
      }
    });
    audio.addEventListener('durationchange', function() { if (audio.duration && audio.duration !== Infinity) timeEl.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration); });
    var lastSave = 0;
    audio.addEventListener('timeupdate', function() {
      if (!audio.duration) return;
      var pct = (audio.currentTime / audio.duration) * 100;
      fill.style.width = pct + '%'; thumb.style.left = 'calc(' + pct + '% - 7px)'; timeEl.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration);
      if (Date.now() - lastSave > 5000) { saveProgress(); lastSave = Date.now(); }
    });

    // ── Seeking ──
    restartBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); if (!audioReady) return; audio.currentTime = 0; fill.style.width = '0%'; thumb.style.left = '-7px'; timeEl.textContent = fmt(0) + ' / ' + (audio.duration ? fmt(audio.duration) : '0:00'); clearProgress(); if (audio.paused) audio.play(); });
    var draggingMain = false;
    function mainSeek(e) { var t = e.touches ? e.touches[0] : e; var r = track.getBoundingClientRect(); audio.currentTime = Math.max(0, Math.min(1, (t.clientX - r.left) / r.width)) * audio.duration; }
    track.addEventListener('click', function(e) { if (!audio.duration) return; mainSeek(e); });
    track.addEventListener('mousedown', function(e) { if (!audio.duration) return; draggingMain = true; mainSeek(e); e.preventDefault(); });
    track.addEventListener('touchstart', function(e) { if (!audio.duration) return; draggingMain = true; mainSeek(e); e.preventDefault(); }, { passive: false });
    document.addEventListener('mousemove', function(e) { if (draggingMain && audio.duration) mainSeek(e); });
    document.addEventListener('touchmove', function(e) { if (draggingMain && audio.duration) { mainSeek(e); e.preventDefault(); } }, { passive: false });
    document.addEventListener('mouseup', function() { draggingMain = false; });
    document.addEventListener('touchend', function() { draggingMain = false; });

    // ── Speed menu ──
    speeds.forEach(function(s) {
      var btn = document.createElement('button');
      btn.textContent = s + 'x';
      btn.style.cssText = 'display:block;width:100%;background:transparent;border:none;color:#000;font-size:12px;padding:4px 14px;border-radius:5px;cursor:pointer;text-align:left;white-space:nowrap;';
      btn.addEventListener('mouseenter', function() { btn.style.background = '#111'; btn.style.color = '#fff'; });
      btn.addEventListener('mouseleave', function() { if (currentSpeed !== s) { btn.style.background = 'transparent'; btn.style.color = '#000'; } });
      btn.addEventListener('click', function() {
        currentSpeed = s; window.npShared.currentSpeed = s; audio.playbackRate = s; speedBtn.textContent = s + 'x';
        speedMenu.style.display = 'none';
        speedMenu.querySelectorAll('button').forEach(function(b) { b.style.background = 'transparent'; b.style.color = '#000'; });
        btn.style.background = '#111'; btn.style.color = '#fff';
        var ms = document.getElementById('np-mini-speed'); if (ms) ms.textContent = s + 'x';
        var mbs = document.getElementById('np-mob-speed'); if (mbs) mbs.textContent = s + 'x';
      });
      if (s === 1) { btn.style.background = '#111'; btn.style.color = '#fff'; }
      speedMenu.appendChild(btn);
    });
    speedBtn.addEventListener('click', function(e) { e.stopPropagation(); speedMenu.style.display = speedMenu.style.display === 'none' ? 'flex' : 'none'; speedMenu.style.flexDirection = 'column'; speedMenu.style.gap = '2px'; });
    document.addEventListener('click', function() { speedMenu.style.display = 'none'; });

    // ── Mini player ──
    var miniPlayer = document.getElementById('np-mini-player');
    var miniPlayBtn = document.getElementById('np-mini-play');
    var miniIconPlay = document.getElementById('np-mini-icon-play');
    var miniIconPause = document.getElementById('np-mini-icon-pause');
    var miniFill = document.getElementById('np-mini-progress-fill');
    var miniThumb = document.getElementById('np-mini-progress-thumb');
    var miniTrack = document.getElementById('np-mini-progress-track');
    var miniTime = document.getElementById('np-mini-time');
    var miniSpeedBtn = document.getElementById('np-mini-speed');
    var miniRestartBtn = document.getElementById('np-mini-restart');
    var miniVisible = false;

    function updateMiniIcons() { if (audio.paused) { miniIconPlay.style.display = 'block'; miniIconPause.style.display = 'none'; } else { miniIconPlay.style.display = 'none'; miniIconPause.style.display = 'block'; miniThumb.style.display = 'block'; } }
    audio.addEventListener('play', updateMiniIcons);
    audio.addEventListener('pause', updateMiniIcons);
    audio.addEventListener('ended', function() { updateMiniIcons(); miniFill.style.height = '0%'; miniThumb.style.top = '0'; });
    audio.addEventListener('timeupdate', function() { if (!audio.duration) return; var p = (audio.currentTime / audio.duration) * 100; miniFill.style.height = p + '%'; miniThumb.style.top = 'calc(' + p + '% - 7px)'; miniTime.textContent = fmt(audio.currentTime); });
    miniPlayBtn.addEventListener('click', function() { if (!audioReady) return; if (audio.paused) audio.play(); else audio.pause(); });
    var draggingMini = false;
    function miniSeek(e) { if (!audio.duration) return; var r = miniTrack.getBoundingClientRect(); audio.currentTime = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * audio.duration; }
    miniTrack.addEventListener('click', miniSeek);
    miniTrack.addEventListener('mousedown', function(e) { if (audio.duration) { draggingMini = true; miniSeek(e); e.preventDefault(); } });
    document.addEventListener('mousemove', function(e) { if (draggingMini) miniSeek(e); });
    document.addEventListener('mouseup', function() { draggingMini = false; });
    miniRestartBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); if (!audioReady) return; audio.currentTime = 0; fill.style.width = '0%'; thumb.style.left = '-7px'; miniFill.style.height = '0%'; miniThumb.style.top = '0'; timeEl.textContent = fmt(0) + ' / ' + (audio.duration ? fmt(audio.duration) : '0:00'); miniTime.textContent = '0:00'; clearProgress(); if (audio.paused) audio.play(); });
    miniSpeedBtn.addEventListener('click', function() { var idx = speeds.indexOf(currentSpeed); currentSpeed = speeds[(idx + 1) % speeds.length]; window.npShared.currentSpeed = currentSpeed; audio.playbackRate = currentSpeed; speedBtn.textContent = currentSpeed + 'x'; miniSpeedBtn.textContent = currentSpeed + 'x'; var mbs = document.getElementById('np-mob-speed'); if (mbs) mbs.textContent = currentSpeed + 'x'; speedMenu.querySelectorAll('button').forEach(function(b) { if (b.textContent === currentSpeed + 'x') { b.style.background = '#111'; b.style.color = '#fff'; } else { b.style.background = 'transparent'; b.style.color = '#000'; } }); });
    function checkMiniVis() { if (window.innerWidth <= 1100 || !player) return; var r = player.getBoundingClientRect(); var show = r.bottom < 0; if (show && !miniVisible) { miniVisible = true; miniPlayer.classList.remove('hiding'); miniPlayer.classList.add('visible'); } else if (!show && miniVisible) { miniVisible = false; miniPlayer.classList.add('hiding'); miniPlayer.classList.remove('visible'); setTimeout(function() { if (!miniVisible) miniPlayer.classList.remove('hiding'); }, 250); } }
    window.addEventListener('scroll', checkMiniVis, { passive: true });
    window.addEventListener('resize', function() { if (window.innerWidth <= 1100) { miniPlayer.classList.remove('visible', 'hiding'); miniVisible = false; } });
    window.addEventListener('beforeunload', function() { if (audioReady && audio.currentTime > 5) saveProgress(); });

    // ── Mobile bar ──
    var mobileBar = document.getElementById('np-mobile-bar');
    var mobPlayBtn = document.getElementById('np-mob-play');
    var mobIconPlay = document.getElementById('np-mob-icon-play');
    var mobIconPause = document.getElementById('np-mob-icon-pause');
    var mobFill = document.getElementById('np-mobile-bar-fill');
    var mobTrack = document.getElementById('np-mobile-bar-track');
    var mobTime = document.getElementById('np-mob-time');
    var mobSpeedBtn = document.getElementById('np-mob-speed');
    var mobRestartBtn = document.getElementById('np-mob-restart');
    var mobileBarVisible = false;

    function updateMobIcons() { if (audio.paused) { mobIconPlay.style.display = 'block'; mobIconPause.style.display = 'none'; } else { mobIconPlay.style.display = 'none'; mobIconPause.style.display = 'block'; } }
    audio.addEventListener('play', updateMobIcons);
    audio.addEventListener('pause', updateMobIcons);
    audio.addEventListener('ended', function() { updateMobIcons(); mobFill.style.width = '0%'; });
    audio.addEventListener('timeupdate', function() { if (!audio.duration) return; mobFill.style.width = (audio.currentTime / audio.duration) * 100 + '%'; mobTime.textContent = fmt(audio.currentTime); });
    mobPlayBtn.addEventListener('click', function() { if (!audioReady) return; if (audio.paused) audio.play(); else audio.pause(); });
    var draggingMob = false;
    function mobSeek(e) { if (!audio.duration) return; var t = e.touches ? e.touches[0] : e; var r = mobTrack.getBoundingClientRect(); audio.currentTime = Math.max(0, Math.min(1, (t.clientX - r.left) / r.width)) * audio.duration; }
    mobTrack.addEventListener('click', mobSeek);
    mobTrack.addEventListener('mousedown', function(e) { if (audio.duration) { draggingMob = true; mobSeek(e); e.preventDefault(); } });
    mobTrack.addEventListener('touchstart', function(e) { if (audio.duration) { draggingMob = true; mobSeek(e); e.preventDefault(); } }, { passive: false });
    document.addEventListener('mousemove', function(e) { if (draggingMob) mobSeek(e); });
    document.addEventListener('touchmove', function(e) { if (draggingMob) { mobSeek(e); e.preventDefault(); } }, { passive: false });
    document.addEventListener('mouseup', function() { draggingMob = false; });
    document.addEventListener('touchend', function() { draggingMob = false; });
    mobSpeedBtn.addEventListener('click', function() { var idx = speeds.indexOf(currentSpeed); currentSpeed = speeds[(idx + 1) % speeds.length]; window.npShared.currentSpeed = currentSpeed; audio.playbackRate = currentSpeed; speedBtn.textContent = currentSpeed + 'x'; miniSpeedBtn.textContent = currentSpeed + 'x'; mobSpeedBtn.textContent = currentSpeed + 'x'; speedMenu.querySelectorAll('button').forEach(function(b) { if (b.textContent === currentSpeed + 'x') { b.style.background = '#111'; b.style.color = '#fff'; } else { b.style.background = 'transparent'; b.style.color = '#000'; } }); });
    mobRestartBtn.addEventListener('click', function(e) { e.preventDefault(); if (!audioReady) return; audio.currentTime = 0; fill.style.width = '0%'; thumb.style.left = '-7px'; mobFill.style.width = '0%'; mobTime.textContent = '0:00'; miniFill.style.height = '0%'; miniThumb.style.top = '0'; timeEl.textContent = fmt(0) + ' / ' + (audio.duration ? fmt(audio.duration) : '0:00'); miniTime.textContent = '0:00'; clearProgress(); if (audio.paused) audio.play(); });
    function checkMobVis() { if (window.innerWidth > 1100 || !player) return; var r = player.getBoundingClientRect(); var show = r.bottom < -800; if (show && !mobileBarVisible) { mobileBarVisible = true; mobileBar.classList.remove('hiding'); mobileBar.classList.add('visible'); } else if (!show && mobileBarVisible) { mobileBarVisible = false; mobileBar.classList.add('hiding'); mobileBar.classList.remove('visible'); setTimeout(function() { if (!mobileBarVisible) mobileBar.classList.remove('hiding'); }, 250); } }
    window.addEventListener('scroll', checkMobVis, { passive: true });
    window.addEventListener('resize', function() { if (window.innerWidth > 1100) { mobileBar.classList.remove('visible', 'hiding'); mobileBarVisible = false; } });
  }
})();
