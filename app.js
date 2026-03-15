// LeasePilot AI - Main Application JavaScript

// Use same origin when served over http(s); fallback to localhost when opened via file:// or origin missing
const API_BASE_URL = (typeof window !== 'undefined' && window.location.origin && window.location.origin.startsWith('http'))
  ? `${window.location.origin}/api`
  : 'http://localhost:3000/api';
// Origin for avatar/image URLs: use API host so uploads are served from the server that has the files (fixes 404 when app and API are on different origins)
function getAvatarOrigin() {
  if (typeof API_BASE_URL !== 'undefined' && API_BASE_URL) {
    const o = API_BASE_URL.replace(/\/api\/?$/, '');
    if (o) return o;
  }
  return (typeof window !== 'undefined' && window.location && window.location.origin) || '';
}

// API Helper Functions
const API = {
  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
        credentials: 'include', // send httpOnly auth cookie automatically
      });

      if (!response.ok) {
        let errorMessage = `Request failed with status ${response.status}`;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const errorData = await response.json().catch(() => ({}));
          errorMessage = errorData.error || errorData.message || errorMessage;
        } else {
          const text = await response.text().catch(() => '');
          if (text) errorMessage = text;
        }
        if (response.status === 429) {
          errorMessage = errorMessage.includes('many') ? errorMessage : 'Too many requests. Please try again in a few minutes.';
        }
        if (response.status === 503) {
          errorMessage = errorMessage.includes('unavailable') ? errorMessage : 'Service unavailable. The database may be disconnected.';
        }
        const err = new Error(errorMessage);
        err.status = response.status;
        // Session expired or invalid: clear local cache and redirect to login
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem('user');
          const p = (typeof window !== 'undefined' && window.location.pathname) || '';
          window.location.href = (p.includes('/tenant/') || p.includes('/contractor/')) ? '../login.html' : 'login.html';
        }
        throw err;
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  },

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint, data) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  put(endpoint, data) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  patch(endpoint, data) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  },

  async uploadAvatar(file) {
    const formData = new FormData();
    formData.append('avatar', file, file.name || 'avatar.jpg');
    const response = await fetch(`${API_BASE_URL}/users/me/avatar`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Upload failed (${response.status})`);
    }
    return await response.json();
  },

  async uploadPropertyDocument(propertyId, file, name) {
    const formData = new FormData();
    formData.append('file', file, file.name || 'document');
    if (name) formData.append('name', name);
    const response = await fetch(`${API_BASE_URL}/properties/${propertyId}/documents`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Upload failed (${response.status})`);
    }
    return await response.json();
  }
};

// Authentication Check — relies on httpOnly cookie sent automatically by browser
async function checkAuth() {
  if (window.location.pathname.includes('login.html') || window.location.pathname.includes('signup.html')) {
    return true;
  }

  try {
    const response = await API.get('/auth/verify');
    if (response.user) {
      localStorage.setItem('user', JSON.stringify(response.user));
      const role = (response.user.role || '').toLowerCase();
      const path = window.location.pathname || '';
      const isTenantPage = path.includes('/tenant/');
      const isContractorPage = path.includes('/contractor/');
      if (role === 'tenant' && !isTenantPage) { window.location.href = 'tenant/dashboard.html'; return false; }
      if (role === 'contractor' && !isContractorPage) { window.location.href = 'contractor/messages.html'; return false; }
      if (role !== 'tenant' && isTenantPage) { window.location.href = '../index.html'; return false; }
      if (role !== 'contractor' && isContractorPage) { window.location.href = '../index.html'; return false; }
      return true;
    }
  } catch (error) {
    const status = error && error.status;
    if (status === 401 || status === 403) {
      localStorage.removeItem('user');
      const p = (typeof window !== 'undefined' && window.location.pathname) || '';
      window.location.href = (p.includes('/tenant/') || p.includes('/contractor/')) ? '../login.html' : 'login.html';
      return false;
    }
    // Network/server errors don't kill the session
    if (typeof window !== 'undefined' && window.LeasePilot?.Toast?.show) {
      window.LeasePilot.Toast.show('Could not verify session. Refresh to try again.', 'error');
    }
    return true;
  }
}

// Get current user
function getCurrentUser() {
  const userStr = localStorage.getItem('user');
  return userStr ? JSON.parse(userStr) : null;
}

// Logout — clear local state immediately, fire cookie-clear request, then redirect
function logout() {
  localStorage.removeItem('user');
  Object.keys(_cache).forEach(function(k) { delete _cache[k]; });
  const p = (typeof window !== 'undefined' && window.location.pathname) || '';
  const loginUrl = (p.includes('/tenant/') || p.includes('/contractor/')) ? '../login.html' : 'login.html';
  // keepalive=true lets the browser finish the request even after page navigation
  fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include', keepalive: true })
    .catch(function() {});
  window.location.href = loginUrl;
}

// Initialize Lucide icons
function initIcons() {
  if (typeof lucide !== 'undefined') {
    lucide.createIcons({
      attrs: {
        'stroke-width': 1.5
      }
    });
  }
}

// In-memory TTL cache for read-heavy endpoints (5 minute TTL)
const _cache = {};
const CACHE_TTL = 5 * 60 * 1000;
function cacheGet(key) {
  const entry = _cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { delete _cache[key]; return null; }
  return entry.data;
}
function cacheSet(key, data) { _cache[key] = { data, ts: Date.now() }; }
function cacheInvalidate(prefix) {
  Object.keys(_cache).forEach(function(k) { if (k.startsWith(prefix)) delete _cache[k]; });
}

// Data Management
const DataManager = {
  // Properties
  async getProperties() {
    const hit = cacheGet('properties');
    if (hit) return hit;
    try {
      const data = await API.get('/properties');
      cacheSet('properties', data);
      return data;
    } catch (error) {
      if (error.status !== 401 && error.status !== 403 && typeof window !== 'undefined' && window.LeasePilot?.Toast?.show) {
        window.LeasePilot.Toast.show(error.message || 'Failed to load properties.', 'error');
      }
      return [];
    }
  },
  
  async getProperty(id) {
    try {
      return await API.get(`/properties/${id}`);
    } catch (error) {
      console.error('Error fetching property:', error);
      return null;
    }
  },
  
  async saveProperty(property) {
    try {
      const result = property.id
        ? await API.put(`/properties/${property.id}`, property)
        : await API.post('/properties', property);
      cacheInvalidate('properties');
      return result;
    } catch (error) {
      console.error('Error saving property:', error);
      throw error;
    }
  },

  async deleteProperty(id) {
    try {
      const result = await API.delete(`/properties/${id}`);
      cacheInvalidate('properties');
      return result;
    } catch (error) {
      console.error('Error deleting property:', error);
      throw error;
    }
  },
  
  // Tenants
  async getTenants() {
    const hit = cacheGet('tenants');
    if (hit) return hit;
    try {
      const data = await API.get('/tenants');
      cacheSet('tenants', data);
      return data;
    } catch (error) {
      if (error.status !== 401 && error.status !== 403 && typeof window !== 'undefined' && window.LeasePilot?.Toast?.show) {
        window.LeasePilot.Toast.show(error.message || 'Failed to load tenants.', 'error');
      }
      return [];
    }
  },
  
  async getTenant(id) {
    try {
      return await API.get(`/tenants/${id}`);
    } catch (error) {
      console.error('Error fetching tenant:', error);
      return null;
    }
  },
  
  async saveTenant(tenant) {
    cacheInvalidate('tenants');
    cacheInvalidate('properties');
    try {
      const rawId = tenant.propertyId ?? tenant.property_id;
      const apiTenant = {
        first_name: (tenant.firstName ?? tenant.first_name ?? '').toString().trim(),
        last_name: (tenant.lastName ?? tenant.last_name ?? '').toString().trim(),
        email: (tenant.email ?? '').toString().trim() || null,
        phone: (tenant.phone ?? '').toString().trim() || null,
        property_id: (rawId === '' || rawId == null) ? null : rawId,
        unit: (tenant.unit ?? '').toString().trim() || null,
        status: tenant.status || 'active',
        lease_start: tenant.lease_start || null,
        lease_end: tenant.lease_end || null
      };

      if (tenant.id) {
        return await API.put(`/tenants/${tenant.id}`, apiTenant);
      } else {
        return await API.post('/tenants', apiTenant);
      }
    } catch (error) {
      console.error('Error saving tenant:', error);
      throw error;
    }
  },
  
  async deleteTenant(id) {
    try {
      const result = await API.delete(`/tenants/${id}`);
      cacheInvalidate('tenants');
      cacheInvalidate('properties');
      return result;
    } catch (error) {
      console.error('Error deleting tenant:', error);
      throw error;
    }
  },
  
  // Transactions
  async getTransactions() {
    const hit = cacheGet('transactions');
    if (hit) return hit;
    try {
      const data = await API.get('/transactions');
      cacheSet('transactions', data);
      return data;
    } catch (error) {
      console.error('Error fetching transactions:', error);
      return [];
    }
  },
  
  async getTransaction(id) {
    try {
      return await API.get(`/transactions/${id}`);
    } catch (error) {
      console.error('Error fetching transaction:', error);
      return null;
    }
  },
  
  async saveTransaction(transaction) {
    cacheInvalidate('transactions');
    try {
      // Convert to API format
      const apiTransaction = {
        type: transaction.type,
        description: transaction.description,
        amount: parseFloat(transaction.amount),
        category: transaction.category,
        property_id: transaction.propertyId || transaction.property_id || null,
        transaction_date: transaction.date || transaction.transaction_date,
        status: transaction.status || 'cleared'
      };

      if (transaction.id) {
        return await API.put(`/transactions/${transaction.id}`, apiTransaction);
      } else {
        return await API.post('/transactions', apiTransaction);
      }
    } catch (error) {
      console.error('Error saving transaction:', error);
      throw error;
    }
  },
  
  async deleteTransaction(id) {
    try {
      const result = await API.delete(`/transactions/${id}`);
      cacheInvalidate('transactions');
      return result;
    } catch (error) {
      console.error('Error deleting transaction:', error);
      throw error;
    }
  },

  // Maintenance requests (tenant-submitted; manager view)
  async getMaintenanceRequests(propertyId) {
    try {
      const q = propertyId != null ? `?property_id=${encodeURIComponent(propertyId)}` : '';
      return await API.get('/maintenance-requests' + q);
    } catch (error) {
      console.error('Error fetching maintenance requests:', error);
      throw error;
    }
  },

  async updateMaintenanceRequest(id, data) {
    try {
      return await API.patch('/maintenance-requests/' + encodeURIComponent(id), data);
    } catch (error) {
      console.error('Error updating maintenance request:', error);
      throw error;
    }
  },

  // Contractors (manager's vendor list)
  async getContractors() {
    const hit = cacheGet('contractors');
    if (hit) return hit;
    try {
      const data = await API.get('/contractors');
      cacheSet('contractors', data);
      return data;
    } catch (error) {
      console.error('Error fetching contractors:', error);
      throw error;
    }
  },
  async createContractor(data) {
    try {
      const result = await API.post('/contractors', data);
      cacheInvalidate('contractors');
      return result;
    } catch (error) {
      console.error('Error creating contractor:', error);
      throw error;
    }
  },
  async updateContractor(id, data) {
    try {
      const result = await API.patch('/contractors/' + encodeURIComponent(id), data);
      cacheInvalidate('contractors');
      return result;
    } catch (error) {
      console.error('Error updating contractor:', error);
      throw error;
    }
  },
  async deleteContractor(id) {
    try {
      const result = await API.delete('/contractors/' + encodeURIComponent(id));
      cacheInvalidate('contractors');
      return result;
    } catch (error) {
      console.error('Error deleting contractor:', error);
      throw error;
    }
  },

  // SMS (Twilio)
  async getSmsStatus() {
    try {
      return await API.get('/sms/status');
    } catch (error) {
      return { configured: false };
    }
  },
  async sendSms(to, body) {
    return await API.post('/sms/send', { to, body });
  },
  async sendSmsToContractor(contractorId, body) {
    return await API.post('/sms/send-to-contractor/' + encodeURIComponent(contractorId), { body });
  },
  async sendSmsToTenant(tenantId, body) {
    return await API.post('/sms/send-to-tenant/' + encodeURIComponent(tenantId), { body });
  },

  // In-app messages (manager → tenant or contractor)
  async getMessages(recipientType) {
    try {
      const q = recipientType ? '?recipient_type=' + encodeURIComponent(recipientType) : '';
      return await API.get('/messages' + q);
    } catch (error) {
      console.error('Error fetching messages:', error);
      throw error;
    }
  },
  async sendMessage(data) {
    try {
      return await API.post('/messages', data);
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  },
  async replyToThread(replyToMessageId, body, sendSms) {
    try {
      return await API.post('/messages/reply', {
        reply_to_message_id: replyToMessageId,
        body: body,
        send_sms: !!sendSms
      });
    } catch (error) {
      console.error('Error replying to thread:', error);
      throw error;
    }
  },

  // Tenant: my messages from manager
  async getMyMessages() {
    try {
      return await API.get('/tenant/messages');
    } catch (error) {
      console.error('Error fetching messages:', error);
      throw error;
    }
  },
  async getTenantUnreadMessageCount() {
    try {
      const data = await API.get('/tenant/messages/unread-count');
      return data && typeof data.unread_count === 'number' ? data.unread_count : 0;
    } catch (e) {
      return 0;
    }
  },
  async markMessageRead(messageId) {
    try {
      return await API.patch('/tenant/messages/' + encodeURIComponent(messageId) + '/read');
    } catch (error) {
      console.error('Error marking message read:', error);
      throw error;
    }
  },
  async replyToMessage(parentMessageId, body) {
    try {
      return await API.post('/tenant/messages', { parent_message_id: parentMessageId, body: body });
    } catch (error) {
      console.error('Error replying to message:', error);
      throw error;
    }
  },

  // Notifications: unread message count (replies from tenants/contractors to manager)
  async getNotifications() {
    return [];
  },
  async addNotification(notification) {
    return notification;
  },
  async markNotificationRead() {
    return undefined;
  },
  async getUnreadCount() {
    try {
      const user = getCurrentUser();
      if (!user || (user.role || '').toLowerCase() !== 'portfolio manager') return 0;
      const data = await API.get('/messages/unread-count');
      return data && typeof data.count === 'number' ? data.count : 0;
    } catch (e) {
      return 0;
    }
  },
  async markRepliesRead() {
    try {
      const user = getCurrentUser();
      if (!user || (user.role || '').toLowerCase() !== 'portfolio manager') return;
      await API.post('/messages/mark-replies-read');
    } catch (e) {}
  },

  // Current user profile (for settings)
  async getProfile() {
    try {
      return await API.get('/users/me');
    } catch (error) {
      console.error('Error fetching profile:', error);
      throw error;
    }
  },
  async updateProfile(data) {
    try {
      return await API.put('/users/me', data);
    } catch (error) {
      console.error('Error updating profile:', error);
      throw error;
    }
  },
  async deleteAccount() {
    try {
      return await API.delete('/users/me');
    } catch (error) {
      console.error('Error deleting account:', error);
      throw error;
    }
  },
  async uploadAvatar(file) {
    try {
      const formData = new FormData();
      formData.append('avatar', file, file.name || 'avatar.jpg');
      const API_BASE = (typeof window !== 'undefined' && window.location.origin && window.location.origin.startsWith('http'))
        ? `${window.location.origin}/api`
        : 'http://localhost:3000/api';
      const response = await fetch(`${API_BASE}/users/me/avatar`, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed (${response.status})`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error uploading avatar:', error);
      throw error;
    }
  }
};

// Modal Management
const Modal = {
  open: function(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      document.body.style.overflow = 'hidden';
      // Only init icons inside this modal, not the entire page
      if (typeof lucide !== 'undefined') {
        lucide.createIcons({ attrs: { 'stroke-width': 1.5 }, nameAttr: 'data-lucide', rootElement: modal });
      }
    }
  },
  
  close: function(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      document.body.style.overflow = '';
    }
  },
  
  init: function() {
    // Close on backdrop click
    document.addEventListener('click', function(e) {
      if (e.target.classList.contains('modal-backdrop')) {
        const modal = e.target.closest('.modal');
        if (modal) {
          Modal.close(modal.id);
        }
      }
    });
    
    // Close on Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        const openModal = document.querySelector('.modal:not(.hidden)');
        if (openModal) {
          Modal.close(openModal.id);
        }
      }
    });
  }
};

// Inline SVGs for toast icons — avoids triggering a full-page lucide.createIcons() scan
const _toastIcons = {
  success: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  error: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  info: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
};

// Toast Notifications
const Toast = {
  show: function(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `fixed top-4 right-4 z-50 px-6 py-4 rounded-xl shadow-lg flex items-center gap-3 transform transition-all ${
      type === 'success' ? 'bg-green-500 text-white' :
      type === 'error' ? 'bg-red-500 text-white' :
      'bg-slate-900 text-white'
    }`;
    toast.style.transform = 'translateX(400px)';
    const iconDiv = document.createElement('div');
    iconDiv.innerHTML = _toastIcons[type] || _toastIcons.info;
    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;
    toast.appendChild(iconDiv.firstChild || iconDiv);
    toast.appendChild(msgSpan);
    document.body.appendChild(toast);

    // Animate in
    setTimeout(() => { toast.style.transform = 'translateX(0)'; }, 10);

    // Animate out and remove
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(400px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
};

// Format currency
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
}

// Format date
function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

// Initialize app
document.addEventListener('DOMContentLoaded', async function() {
  initIcons();
  Modal.init();
  
  // Update user info in sidebar if present
  const user = getCurrentUser();
  if (user) {
    const userElements = document.querySelectorAll('[data-user-name]');
    userElements.forEach(el => {
      el.textContent = user.name;
    });
    // Update sidebar avatar so it stays consistent across all pages
    const defaultAvatar = 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=100&h=100';
    const avatarUrl = (user.avatar_url && user.avatar_url.trim())
      ? (user.avatar_url.startsWith('/uploads/avatars/')
          ? getAvatarOrigin() + '/api/avatar/' + user.avatar_url.split('/').pop()
          : user.avatar_url.startsWith('/') ? getAvatarOrigin() + user.avatar_url : user.avatar_url)
      : defaultAvatar;
    document.querySelectorAll('[data-user-avatar]').forEach(img => {
      img.src = avatarUrl;
      img.onerror = function () { this.onerror = null; this.src = defaultAvatar; };
    });
  }
  
  // Update notification count (replies from tenants/contractors)
  const unreadCount = await DataManager.getUnreadCount();
  const notificationBadges = document.querySelectorAll('[data-notification-count]');
  notificationBadges.forEach(badge => {
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  });
});

// Export for use in other scripts
window.LeasePilot = {
  checkAuth,
  getCurrentUser,
  logout,
  DataManager,
  Modal,
  Toast,
  formatCurrency,
  formatDate,
  initIcons,
  API,
  getAvatarOrigin
};
