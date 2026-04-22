(function() {
  var API = 'https://audio-narration-production.up.railway.app';
  var slug = window.location.pathname.split('/').filter(Boolean).pop();

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
  var isLoading = false;
  var audioReady = false;

  // Hide player until we confirm audio exists
  if (player) player.style.display = 'none';

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

  fetch(API + '/api/spotify/' + slug)
    .then(function(r) { return r.json(); })
    .then(function(d) { if (d.url) initSpotify(d.url); })
    .catch(function() {});

  // ── Helpers ──
  function fmt(s) { var m = Math.floor(s / 60); var sec = Math.floor(s % 60); return m + ':' + (sec < 10 ? '0' : '') + sec; }
  function showIcon(w) { iconPlay.style.display = w === 'play' ? 'block' : 'none'; iconPause.style.display = w === 'pause' ? 'block' : 'none'; iconLoading.style.display = w === 'loading' ? 'block' : 'none'; }
  function showDownloadBtn() { downloadBtn.style.display = 'block'; }
  downloadBtn.addEventListener('click', function() { window.location.href = API + '/api/narration/' + slug + '/download'; });

  // ── Progress persistence ──
  var storageKey = 'np_resume_' + slug;
  function saveProgress() { if (audio.duration && audio.currentTime > 5) localStorage.setItem(storageKey, JSON.stringify({ time: audio.currentTime, duration: audio.duration, speed: currentSpeed, updated: Date.now() })); }
  function loadProgress() { try { var s = JSON.parse(localStorage.getItem(storageKey)); if (!s) return null; if (Date.now() - s.updated > 30*24*60*60*1000) { localStorage.removeItem(storageKey); return null; } return s; } catch(e) { return null; } }
  function clearProgress() { localStorage.removeItem(storageKey); }

  // ── Check if audio exists — show player only if it does ──
  fetch(API + '/api/narration/' + slug).then(function(r) { return r.json(); }).then(function(data) {
    if (data.exists) {
      if (player) player.style.display = '';
      audio.src = data.url;
      audioReady = true;
      showDownloadBtn();
      var saved = loadProgress();
      if (saved && saved.time > 5) {
        var pct = saved.duration ? (saved.time / saved.duration) * 100 : 0;
        if (pct > 0 && pct < 100) { fill.style.width = pct + '%'; thumb.style.left = 'calc(' + pct + '% - 7px)'; thumb.style.display = 'block'; timeEl.textContent = fmt(saved.time) + ' / ' + (saved.duration ? fmt(saved.duration) : '0:00'); }
        if (saved.speed) { currentSpeed = saved.speed; audio.playbackRate = saved.speed; speedBtn.textContent = saved.speed + 'x'; window.npShared.currentSpeed = saved.speed; }
      }
    }
    // If !data.exists, player stays hidden
  }).catch(function() {});

  // ── Play button ──
  playBtn.addEventListener('click', function() {
    if (isLoading) return;
    if (audio.paused) audio.play(); else audio.pause();
  });

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

  // ── Track seeking ──
  track.addEventListener('click', function(e) { if (!audio.duration) return; var r = track.getBoundingClientRect(); audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration; });

  restartBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); if (!audioReady || !audio.src) return; audio.currentTime = 0; fill.style.width = '0%'; thumb.style.left = '-7px'; timeEl.textContent = fmt(0) + ' / ' + (audio.duration ? fmt(audio.duration) : '0:00'); clearProgress(); if (audio.paused) audio.play(); });

  var draggingMain = false;
  function mainSeek(e) { var t = e.touches ? e.touches[0] : e; var r = track.getBoundingClientRect(); audio.currentTime = Math.max(0, Math.min(1, (t.clientX - r.left) / r.width)) * audio.duration; }
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
  var mainPlayerEl = document.getElementById('narration-player');
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

  miniRestartBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); if (!audioReady || !audio.src) return; audio.currentTime = 0; fill.style.width = '0%'; thumb.style.left = '-7px'; miniFill.style.height = '0%'; miniThumb.style.top = '0'; timeEl.textContent = fmt(0) + ' / ' + (audio.duration ? fmt(audio.duration) : '0:00'); miniTime.textContent = '0:00'; clearProgress(); if (audio.paused) audio.play(); });
  miniSpeedBtn.addEventListener('click', function() { var idx = speeds.indexOf(currentSpeed); currentSpeed = speeds[(idx + 1) % speeds.length]; window.npShared.currentSpeed = currentSpeed; audio.playbackRate = currentSpeed; speedBtn.textContent = currentSpeed + 'x'; miniSpeedBtn.textContent = currentSpeed + 'x'; var mbs = document.getElementById('np-mob-speed'); if (mbs) mbs.textContent = currentSpeed + 'x'; speedMenu.querySelectorAll('button').forEach(function(b) { if (b.textContent === currentSpeed + 'x') { b.style.background = '#111'; b.style.color = '#fff'; } else { b.style.background = 'transparent'; b.style.color = '#000'; } }); });

  function checkMiniVis() { if (window.innerWidth <= 1100 || !mainPlayerEl) return; var r = mainPlayerEl.getBoundingClientRect(); var show = r.bottom < 0; if (show && !miniVisible) { miniVisible = true; miniPlayer.classList.remove('hiding'); miniPlayer.classList.add('visible'); } else if (!show && miniVisible) { miniVisible = false; miniPlayer.classList.add('hiding'); miniPlayer.classList.remove('visible'); setTimeout(function() { if (!miniVisible) miniPlayer.classList.remove('hiding'); }, 250); } }
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
  mobRestartBtn.addEventListener('click', function(e) { e.preventDefault(); if (!audioReady || !audio.src) return; audio.currentTime = 0; fill.style.width = '0%'; thumb.style.left = '-7px'; mobFill.style.width = '0%'; mobTime.textContent = '0:00'; miniFill.style.height = '0%'; miniThumb.style.top = '0'; timeEl.textContent = fmt(0) + ' / ' + (audio.duration ? fmt(audio.duration) : '0:00'); miniTime.textContent = '0:00'; clearProgress(); if (audio.paused) audio.play(); });

  function checkMobVis() { if (window.innerWidth > 1100 || !mainPlayerEl) return; var r = mainPlayerEl.getBoundingClientRect(); var show = r.bottom < -800; if (show && !mobileBarVisible) { mobileBarVisible = true; mobileBar.classList.remove('hiding'); mobileBar.classList.add('visible'); } else if (!show && mobileBarVisible) { mobileBarVisible = false; mobileBar.classList.add('hiding'); mobileBar.classList.remove('visible'); setTimeout(function() { if (!mobileBarVisible) mobileBar.classList.remove('hiding'); }, 250); } }
  window.addEventListener('scroll', checkMobVis, { passive: true });
  window.addEventListener('resize', function() { if (window.innerWidth > 1100) { mobileBar.classList.remove('visible', 'hiding'); mobileBarVisible = false; } });
})();
