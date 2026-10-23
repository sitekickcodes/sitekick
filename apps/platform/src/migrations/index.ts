import * as migration_20261015_181436_initial from './20261015_181436_initial';
import * as migration_20261018_231958_device_authorizations from './20261018_231958_device_authorizations';
import * as migration_20261018_233736_site_connection from './20261018_233736_site_connection';
import * as migration_20261019_004244_sessions from './20261019_004244_sessions';
import * as migration_20261023_202921_payload_v4_beta from './20261023_202921_payload_v4_beta';
import * as migration_20261023_212139_agent_chat from './20261023_212139_agent_chat';

export const migrations = [
  {
    up: migration_20261015_181436_initial.up,
    down: migration_20261015_181436_initial.down,
    name: '20261015_181436_initial',
  },
  {
    up: migration_20261018_231958_device_authorizations.up,
    down: migration_20261018_231958_device_authorizations.down,
    name: '20261018_231958_device_authorizations',
  },
  {
    up: migration_20261018_233736_site_connection.up,
    down: migration_20261018_233736_site_connection.down,
    name: '20261018_233736_site_connection',
  },
  {
    up: migration_20261019_004244_sessions.up,
    down: migration_20261019_004244_sessions.down,
    name: '20261019_004244_sessions',
  },
  {
    up: migration_20261023_202921_payload_v4_beta.up,
    down: migration_20261023_202921_payload_v4_beta.down,
    name: '20261023_202921_payload_v4_beta',
  },
  {
    up: migration_20261023_212139_agent_chat.up,
    down: migration_20261023_212139_agent_chat.down,
    name: '20261023_212139_agent_chat'
  },
];
