import type {MikroORM} from "@mikro-orm/core"
import type * as better_auth from "better-auth"
import type {AdapterDebugLogs} from "better-auth/adapters"

interface MikroOrmAdapterConfig {
  /**
   * Enable debug logs.
   *
   * @default false
   */
  debugLogs?: AdapterDebugLogs
  /**
   * Indicates whether or not JSON is supported by target database.
   *
   * This option is enabled by default, because Mikro ORM supports JSON serialization/deserialization via [JsonType](https://mikro-orm.io/docs/custom-types#jsontype).
   * See documentation for more info: https://mikro-orm.io/docs/json-properties
   *
   * If disabled, Better Auth will handle these transformations for you.
   *
   * @default true
   */
  supportsJSON?: boolean
}
/**
 * Creates Mikro ORM adapter for Better Auth.
 *
 * Current limitations:
 *   * No m:m and 1:m and embedded references support
 *   * No complex primary key support
 *   * No schema generation
 *
 * @param orm - Instance of Mikro ORM returned from `MikroORM.init` or `MikroORM.initSync` methods
 * @param config - Additional configuration for Mikro ORM adapter
 */
declare const mikroOrmAdapter: (
  orm: MikroORM,
  {debugLogs, supportsJSON}?: MikroOrmAdapterConfig
) => (options: better_auth.BetterAuthOptions) => better_auth.Adapter

export {type MikroOrmAdapterConfig, mikroOrmAdapter}
