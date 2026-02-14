/**
 * Role-based permissions. Tenant has limited self-service; Portfolio Manager has full access.
 */
const TENANT_PERMISSIONS = {
  can_view_own_profile: true,
  can_edit_own_profile: true,
  can_view_lease: true,
  can_view_balance: true,
  can_pay_rent: true,
  can_view_payment_history: true,
  can_submit_maintenance_request: true,
  can_view_maintenance_status: true,
  can_view_announcements: true,
  can_download_documents: true,
  // Explicitly no property/tenant CRUD, lease creation, financial reports, settings, user management
};

const MANAGER_PERMISSIONS = {
  ...TENANT_PERMISSIONS,
  can_manage_properties: true,
  can_manage_tenants: true,
  can_manage_leases: true,
  can_view_financial_reports: true,
  can_manage_settings: true,
  can_manage_users: true,
};

export function getRolePermissions(role) {
  const r = (role || '').trim();
  if (r.toLowerCase() === 'tenant') return { ...TENANT_PERMISSIONS };
  return { ...MANAGER_PERMISSIONS };
}

export function can(role, permission) {
  const perms = getRolePermissions(role);
  return !!perms[permission];
}
