'use strict';

// authz.js — helpers de permisos de interfaz.
// MODO ACTUAL TEMPORAL: permisos de página desactivados para priorizar funcionamiento.
// Todos los módulos y acciones quedan habilitados para cualquier usuario logueado/activo.
// Más adelante se reactivan roles, cuentas, historial y restricciones finas.

const ROLE_ALIASES = {
  admin: 'admin_principal',
  administrador: 'admin_principal',
  administracion: 'admin_principal',
  owner: 'superadmin',
  dueño: 'superadmin',
  dueno: 'superadmin',
  facturador: 'facturacion',
  facturación: 'facturacion',
  billing: 'facturacion',
  lectura: 'solo_vista',
  readonly: 'solo_vista',
  read_only: 'solo_vista',
  viewer: 'solo_vista',
};

export function normalizeRole(role) {
  const raw = String(role || 'usuario').trim().toLowerCase();
  return ROLE_ALIASES[raw] || raw || 'usuario';
}

export function currentUser() {
  return window.CURRENT_USER || { uid: '', email: '', profile: { role: 'usuario', active: true } };
}
export function currentRole() {
  return normalizeRole(currentUser()?.profile?.role);
}

// Si el login dejó pasar al usuario, la interfaz no bloquea acciones por rol.
export function isActiveUser() { return currentUser()?.profile?.active !== false; }
export function isSuperAdmin() { return true; }
export function isAdminPrincipal() { return true; }
export function isAdminLike() { return true; }
export function canView() { return true; }
export function canEditPatient() { return true; }
export function canFacturar() { return true; }
export function canManageUsers() { return true; }
export function canExport() { return true; }
export function canDelete() { return true; }
export function canConfigure() { return true; }
export function canViewAudit() { return true; }
export function canViewRowHistory() { return true; }
