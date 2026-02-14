/**
 * Tenant portal: show unread message count in nav badge and optional dashboard banner.
 * Include this script on every tenant page. Expects #tenantNavMessagesBadge and optional #tenantNewMessagesBanner.
 */
(function() {
  function run() {
    var dm = window.LeasePilot && window.LeasePilot.DataManager;
    if (!dm || typeof dm.getTenantUnreadMessageCount !== 'function') return;
    dm.getTenantUnreadMessageCount().then(function(count) {
      var text = count > 99 ? '99+' : String(count);
      var show = count > 0;
      ['tenantNavMessagesBadge', 'tenantNotificationsBadge'].forEach(function(id) {
        var badge = document.getElementById(id);
        if (badge) {
          badge.textContent = text;
          if (show) {
            badge.classList.remove('hidden');
            badge.classList.add('inline-flex');
          } else {
            badge.classList.add('hidden');
            badge.classList.remove('inline-flex');
          }
        }
      });
      var banner = document.getElementById('tenantNewMessagesBanner');
      if (banner) {
        if (count > 0) {
          var link = banner.querySelector('a');
          var text = banner.querySelector('.tenant-new-messages-text');
          if (text) text.textContent = 'You have ' + count + ' new message' + (count !== 1 ? 's' : '');
          if (link) link.href = 'messages.html';
          banner.classList.remove('hidden');
          banner.classList.add('flex');
          if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
        } else {
          banner.classList.add('hidden');
          banner.classList.remove('flex');
        }
      }
    }).catch(function() {});
  }
  window.TenantNotificationsRefresh = run;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      var wait = 0;
      function tryRun() {
        if (typeof LeasePilot !== 'undefined' && typeof LeasePilot.checkAuth === 'function') {
          LeasePilot.checkAuth().then(function(ok) { if (ok) run(); });
          return;
        }
        wait++;
        if (wait < 100) setTimeout(tryRun, 50);
      }
      tryRun();
    });
  } else {
    if (typeof LeasePilot !== 'undefined' && typeof LeasePilot.checkAuth === 'function') {
      LeasePilot.checkAuth().then(function(ok) { if (ok) run(); });
    } else {
      var wait = 0;
      function tryRun() {
        if (typeof LeasePilot !== 'undefined' && typeof LeasePilot.checkAuth === 'function') {
          LeasePilot.checkAuth().then(function(ok) { if (ok) run(); });
          return;
        }
        wait++;
        if (wait < 100) setTimeout(tryRun, 50);
      }
      tryRun();
    }
  }
})();
