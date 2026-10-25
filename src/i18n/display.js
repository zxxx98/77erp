import { permissionOptions as permissions } from '../../shared/permissions.js';
import { notificationEvents as events, notificationFormats as formats, notificationStatuses as statuses } from '../../shared/notifications.js';
import { contactRoleLabels as roles } from '../../shared/contacts.js';
import { translateText } from './index.js';

const localize = values => values.map(value => ({ ...value,
  get label() { return translateText(value.label); },
  get description() { return translateText(value.description); },
}));
const labels = object => Object.defineProperties({}, Object.fromEntries(Object.entries(object).map(([key, value]) => [key, { enumerable: true, get: () => translateText(value) }])));
export const permissionOptions = localize(permissions);
export const notificationEvents = localize(events);
export const notificationFormats = localize(formats);
export const notificationStatuses = labels(statuses);
export const contactRoleLabels = labels(roles);
