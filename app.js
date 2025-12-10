// LeasePilot AI - Main Application JavaScript

const API_BASE_URL = 'http://localhost:3000/api';

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
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('❌ API Error:', errorData);
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
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

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
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
    window.location.href = 'login.html';
    return false;
  }

  try {
    const response = await API.get('/auth/verify');
    if (response.user) {
      localStorage.setItem('user', JSON.stringify(response.user));
      return true;
    }
  } catch (error) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'login.html';
    return false;
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
  window.location.href = 'login.html';
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
      // Convert to API format
      const apiTenant = {
        first_name: tenant.firstName || tenant.first_name,
        last_name: tenant.lastName || tenant.last_name,
        email: tenant.email,
        phone: tenant.phone,
        property_id: tenant.propertyId || tenant.property_id || null,
        unit: tenant.unit,
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
  
  // Notifications
  async getNotifications() {
    // TODO: Implement when notifications API is ready
    return [];
  },
  
  async addNotification(notification) {
    // TODO: Implement when notifications API is ready
    return notification;
  },
  
  async markNotificationRead(id) {
    // TODO: Implement when notifications API is ready
  },
  
  getUnreadCount() {
    // TODO: Implement when notifications API is ready
    return 0;
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
  
  // Update notification count
  const unreadCount = await DataManager.getUnreadCount();
  const notificationBadges = document.querySelectorAll('[data-notification-count]');
  notificationBadges.forEach(badge => {
    if (unreadCount > 0) {
      badge.textContent = unreadCount;
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
