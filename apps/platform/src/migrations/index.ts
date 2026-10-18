import * as migration_20261015_181436_initial from './20261015_181436_initial';
import * as migration_20261018_231958_device_authorizations from './20261018_231958_device_authorizations';

export const migrations = [
  {
    up: migration_20261015_181436_initial.up,
    down: migration_20261015_181436_initial.down,
    name: '20261015_181436_initial',
  },
  {
    up: migration_20261018_231958_device_authorizations.up,
    down: migration_20261018_231958_device_authorizations.down,
    name: '20261018_231958_device_authorizations'
  },
];
