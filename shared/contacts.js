export const contactRoleLabels = { supplier: '供应商', customer: '客户', internal: '内部单位' };

export const contactMatchesDirection = (contact, type) =>
  contact.role === 'internal' || contact.role === (type === 'in' ? 'supplier' : 'customer');
