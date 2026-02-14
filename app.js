// LeasePilot AI - Main Application JavaScript

// Use same origin when served over http(s); fallback to localhost when opened via file:// or origin missing
const API_BASE_URL = (typeof window !== 'undefined' && window.location.origin && window.location.origin.startsWith('http'))
  ? `${window.location.origin}/api`
  : 'http://localhost:3000/api';

// API Helper Functions
const API = {
  async request(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      console.log(`🌐 API Request: ${options.method || 'GET'} ${API_BASE_URL}${endpoint}`);
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers
      });

      console.log(`📡 Response status: ${response.status} ${response.statusText}`);

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
        console.error('❌ API Error:', { status: response.status, error: errorMessage });
        const err = new Error(errorMessage);
        err.status = response.status;
        // Session expired or invalid: clear and send to login so user doesn't see "empty" data
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          const p = (typeof window !== 'undefined' && window.location.pathname) || '';
          window.location.href = (p.includes('/tenant/') || p.includes('/contractor/')) ? '../login.html' : 'login.html';
        }
        throw err;
      }

      const data = await response.json();
      console.log(`✅ API Success:`, data);
      return data;
  } catch (error) {
    console.error('❌ API Error:', error);
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
    const token = localStorage.getItem('token');
    if (!token) throw new Error('Not logged in');
    const formData = new FormData();
    formData.append('avatar', file, file.name || 'avatar.jpg');
    const response = await fetch(`${API_BASE_URL}/users/me/avatar`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Upload failed (${response.status})`);
    }
    return await response.json();
  }
};

// Authentication Check
async function checkAuth() {
  // Skip auth check on login/signup pages
  if (window.location.pathname.includes('login.html') || window.location.pathname.includes('signup.html')) {
    return true;
  }

  const token = localStorage.getItem('token');
  if (!token) {
    const p = window.location.pathname || '';
    window.location.href = (p.includes('/tenant/') || p.includes('/contractor/')) ? '../login.html' : 'login.html';
    return false;
  }

  try {
    const response = await API.get('/auth/verify');
    if (response.user) {
      localStorage.setItem('user', JSON.stringify(response.user));
      const role = (response.user.role || '').toLowerCase();
      const path = window.location.pathname || '';
      const isTenantPage = path.includes('/tenant/');
      const isContractorPage = path.includes('/contractor/');
      if (role === 'tenant' && !isTenantPage) {
        window.location.href = 'tenant/dashboard.html';
        return false;
      }
      if (role === 'contractor' && !isContractorPage) {
        window.location.href = 'contractor/messages.html';
        return false;
      }
      if (role !== 'tenant' && isTenantPage) {
        window.location.href = '../index.html';
        return false;
      }
      if (role !== 'contractor' && isContractorPage) {
        window.location.href = '../index.html';
        return false;
      }
      return true;
    }
  } catch (error) {
    // Only clear session and redirect on explicit auth failure (401/403).
    // Network errors, 5xx, 503, 429 etc. do not invalidate the token.
    const status = error && error.status;
    if (status === 401 || status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      const p = (typeof window !== 'undefined' && window.location.pathname) || '';
      window.location.href = (p.includes('/tenant/') || p.includes('/contractor/')) ? '../login.html' : 'login.html';
      return false;
    }
    if (typeof window !== 'undefined' && window.LeasePilot && window.LeasePilot.Toast && window.LeasePilot.Toast.show) {
      window.LeasePilot.Toast.show('Could not verify session. You can keep using the app or refresh to try again.', 'error');
    }
    return true;
  }
}

// Get current user
function getCurrentUser() {
  const userStr = localStorage.getItem('user');
  return userStr ? JSON.parse(userStr) : null;
}

// Logout
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  const p = (typeof window !== 'undefined' && window.location.pathname) || '';
  window.location.href = (p.includes('/tenant/') || p.includes('/contractor/')) ? '../login.html' : 'login.html';
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

// Data Management
const DataManager = {
  // Properties
  async getProperties() {
    try {
      return await API.get('/properties');
    } catch (error) {
      console.error('Error fetching properties:', error);
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
      if (property.id) {
        return await API.put(`/properties/${property.id}`, property);
      } else {
        return await API.post('/properties', property);
      }
    } catch (error) {
      console.error('Error saving property:', error);
      throw error;
    }
  },
  
  async deleteProperty(id) {
    try {
      return await API.delete(`/properties/${id}`);
    } catch (error) {
      console.error('Error deleting property:', error);
      throw error;
    }
  },
  
  // Tenants
  async getTenants() {
    try {
      return await API.get('/tenants');
    } catch (error) {
      console.error('Error fetching tenants:', error);
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
      return await API.delete(`/tenants/${id}`);
    } catch (error) {
      console.error('Error deleting tenant:', error);
      throw error;
    }
  },
  
  // Transactions
  async getTransactions() {
    try {
      return await API.get('/transactions');
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
      return await API.delete(`/transactions/${id}`);
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
    try {
      return await API.get('/contractors');
    } catch (error) {
      console.error('Error fetching contractors:', error);
      throw error;
    }
  },
  async createContractor(data) {
    try {
      return await API.post('/contractors', data);
    } catch (error) {
      console.error('Error creating contractor:', error);
      throw error;
    }
  },
  async updateContractor(id, data) {
    try {
      return await API.patch('/contractors/' + encodeURIComponent(id), data);
    } catch (error) {
      console.error('Error updating contractor:', error);
      throw error;
    }
  },
  async deleteContractor(id) {
    try {
      return await API.delete('/contractors/' + encodeURIComponent(id));
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
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Not logged in');
      const formData = new FormData();
      formData.append('avatar', file, file.name || 'avatar.jpg');
      const API_BASE = (typeof window !== 'undefined' && window.location.origin && window.location.origin.startsWith('http'))
        ? `${window.location.origin}/api`
        : 'http://localhost:3000/api';
      const response = await fetch(`${API_BASE}/users/me/avatar`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
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
      initIcons();
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
    toast.innerHTML = `
      <i data-lucide="${type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : 'info'}" class="h-5 w-5"></i>
      <span>${message}</span>
    `;
    document.body.appendChild(toast);
    initIcons();
    
    // Animate in
    setTimeout(() => {
      toast.style.transform = 'translateX(0)';
    }, 10);
    
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
  API
};
