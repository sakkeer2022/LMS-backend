// Public surface of the settings module. Other modules read settings through getSetting.
export { settingsRouter } from './settings.routes.js';
export { getSetting, type SettingView } from './settings.service.js';
export type { SettingDefinition, SettingType, SettingValue } from './settings.registry.js';
