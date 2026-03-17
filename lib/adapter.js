// src/adapter.ts
import {createAdapter} from "better-auth/adapters"
import {dset as dset2} from "dset"

// src/utils/adapterUtils.ts
import {ReferenceKind, serialize} from "@mikro-orm/core"
import {dset} from "dset"

// src/utils/createAdapterError.ts
import {BetterAuthError} from "better-auth"
function createAdapterError(message) {
  throw new BetterAuthError(`[Mikro ORM Adapter] ${message}`)
}

// src/utils/adapterUtils.ts
var ownReferences = [
  ReferenceKind.SCALAR,
  ReferenceKind.ONE_TO_MANY,
  ReferenceKind.EMBEDDED
]
function createAdapterUtils(orm) {
  const naming = orm.config.getNamingStrategy()
  const metadata = orm.getMetadata()
  const normalizeEntityName = name =>
    naming.getEntityName(naming.classToTableName(name))
  const getEntityMetadata = entityName => {
    entityName = normalizeEntityName(entityName)
    if (!metadata.getByClassName(entityName, false)) {
      createAdapterError(
        `Cannot find metadata for "${entityName}" entity. Make sure it defined and listed in your Mikro ORM config.`
      )
    }
    return metadata.getByClassName(entityName)
  }
  function getPropertyMetadata(metadata2, fieldName) {
    const prop = metadata2.props.find(prop2 => {
      if (ownReferences.includes(prop2.kind) && prop2.name === fieldName) {
        return true
      }
      if (
        prop2.kind === ReferenceKind.MANY_TO_ONE &&
        (prop2.name === fieldName ||
          prop2.fieldNames.includes(naming.propertyToColumnName(fieldName)))
      ) {
        return true
      }
      return false
    })
    if (!prop) {
      createAdapterError(
        `Can't find property "${fieldName}" on entity "${metadata2.className}".`
      )
    }
    return prop
  }
  function getReferencedColumnName(entityName, prop) {
    if (ownReferences.includes(prop.kind)) {
      return prop.name
    }
    if (prop.kind === ReferenceKind.MANY_TO_ONE) {
      return naming.columnNameToProperty(naming.joinColumnName(prop.name))
    }
    createAdapterError(
      `Reference kind ${prop.kind} is not supported. Defined in "${entityName}" entity for "${prop.name}" field.`
    )
  }
  const getReferencedPropertyName = (metadata2, prop) =>
    getReferencedColumnName(metadata2.className, prop)
  const getFieldPath = (metadata2, fieldName, throwOnShadowProps = false) => {
    const prop = getPropertyMetadata(metadata2, fieldName)
    if (prop.persist === false && throwOnShadowProps) {
      createAdapterError(
        `Cannot serialize "${fieldName}" into path, because it cannot be persisted in "${metadata2.tableName}" table.`
      )
    }
    if (
      prop.kind === ReferenceKind.SCALAR ||
      prop.kind === ReferenceKind.EMBEDDED
    ) {
      return [prop.name]
    }
    if (prop.kind === ReferenceKind.MANY_TO_ONE) {
      if (prop.referencedPKs.length > 1) {
        createAdapterError(
          `The "${fieldName}" field references to a table "${prop.name}" with complex primary key, which is not supported`
        )
      }
      return [prop.name, naming.referenceColumnName()]
    }
    createAdapterError(
      `Cannot normalize "${fieldName}" field name into path for "${metadata2.className}" entity.`
    )
  }
  const normalizePropertyValue = (property, value) => {
    if (
      !property.targetMeta ||
      property.kind === ReferenceKind.SCALAR ||
      property.kind === ReferenceKind.EMBEDDED
    ) {
      return value
    }
    return orm.em.getReference(property.targetMeta.class, value)
  }
  const normalizeInput = (metadata2, input) => {
    const fields = {}
    Object.entries(input).forEach(([key, value]) => {
      const property = getPropertyMetadata(metadata2, key)
      const normalizedValue = normalizePropertyValue(property, value)
      dset(fields, [property.name], normalizedValue)
    })
    return fields
  }
  const normalizeOutput = (metadata2, output) => {
    output = serialize(output)
    const result = {}
    Object.entries(output)
      .map(([key, value]) => ({
        path: getReferencedPropertyName(
          metadata2,
          getPropertyMetadata(metadata2, key)
        ),
        value
      }))
      .forEach(({path, value}) => dset(result, path, value))
    return result
  }
  function createWhereClause(path, value, op, target = {}) {
    dset(target, op == null || op === "eq" ? path : path.concat(op), value)
    return target
  }
  function createWhereInClause(fieldName, path, value, target) {
    if (!Array.isArray(value)) {
      createAdapterError(
        `The value for the field "${fieldName}" must be an array when using the $in operator.`
      )
    }
    return createWhereClause(path, value, "$in", target)
  }
  const normalizeWhereClauses = (metadata2, where) => {
    if (!where) {
      return {}
    }
    if (where.length === 1) {
      const [w] = where
      if (!w) {
        return {}
      }
      const path = getFieldPath(metadata2, w.field, true)
      switch (w.operator) {
        case "in":
          return createWhereInClause(w.field, path, w.value)
        case "contains":
          return createWhereClause(path, `%${w.value}%`, "$like")
        case "starts_with":
          return createWhereClause(path, `${w.value}%`, "$like")
        case "ends_with":
          return createWhereClause(path, `%${w.value}`, "$like")
        // The next 5 case statemets are _expected_ to fall through so we can simplify and reuse the same logic for these operators
        case "gt":
        case "gte":
        case "lt":
        case "lte":
        case "ne":
          return createWhereClause(path, w.value, `$${w.operator}`)
        default:
          return createWhereClause(path, w.value)
      }
    }
    const result = {}
    where
      .filter(({connector}) => !connector || connector === "AND")
      .forEach(({field, operator, value}, index) => {
        const path = ["$and", index].concat(
          getFieldPath(metadata2, field, true)
        )
        if (operator === "in") {
          return createWhereInClause(field, path, value, result)
        }
        return createWhereClause(path, value, "eq", result)
      })
    where
      .filter(({connector}) => connector === "OR")
      .forEach(({field, value}, index) => {
        const path = ["$and", index].concat(
          getFieldPath(metadata2, field, true)
        )
        return createWhereClause(path, value, "eq", result)
      })
    return result
  }
  return {
    getEntityMetadata,
    normalizeEntityName,
    getFieldPath,
    normalizeInput,
    normalizeOutput,
    normalizeWhereClauses
  }
}

// src/adapter.ts
var mikroOrmAdapter = (orm, {debugLogs, supportsJSON = true} = {}) =>
  createAdapter({
    config: {
      debugLogs,
      supportsJSON,
      adapterId: "mikro-orm-adapter",
      adapterName: "Mikro ORM Adapter"
    },
    adapter({options}) {
      const {
        getEntityMetadata,
        getFieldPath,
        normalizeInput,
        normalizeOutput,
        normalizeWhereClauses
      } = createAdapterUtils(orm)
      return {
        async create({model, data, select}) {
          const metadata = getEntityMetadata(model)
          const input = normalizeInput(metadata, data)
          if (
            options.advanced?.generateId === false &&
            !options.advanced?.database
          ) {
            Reflect.deleteProperty(input, "id")
          }
          const entity = orm.em.create(metadata.class, input)
          await orm.em.flush()
          return normalizeOutput(metadata, entity, select)
        },
        async count({model, where}) {
          const metadata = getEntityMetadata(model)
          return orm.em.count(
            metadata.class,
            normalizeWhereClauses(metadata, where)
          )
        },
        async findOne({model, where, select}) {
          const metadata = getEntityMetadata(model)
          const entity = await orm.em.findOne(
            metadata.class,
            normalizeWhereClauses(metadata, where)
          )
          if (!entity) {
            return null
          }
          return normalizeOutput(metadata, entity, select)
        },
        async findMany({model, where, limit, offset, sortBy}) {
          const metadata = getEntityMetadata(model)
          const options2 = {
            limit,
            offset
          }
          if (sortBy) {
            const path = getFieldPath(metadata, sortBy.field)
            dset2(options2, ["orderBy", ...path], sortBy.direction)
          }
          const rows = await orm.em.find(
            metadata.class,
            normalizeWhereClauses(metadata, where),
            options2
          )
          return rows.map(row => normalizeOutput(metadata, row))
        },
        async update({model, where, update}) {
          const metadata = getEntityMetadata(model)
          const entity = await orm.em.findOne(
            metadata.class,
            normalizeWhereClauses(metadata, where)
          )
          if (!entity) {
            return null
          }
          orm.em.assign(entity, normalizeInput(metadata, update))
          await orm.em.flush()
          return normalizeOutput(metadata, entity)
        },
        async updateMany({model, where, update}) {
          const metadata = getEntityMetadata(model)
          return orm.em.nativeUpdate(
            metadata.class,
            normalizeWhereClauses(metadata, where),
            normalizeInput(metadata, update)
          )
        },
        async delete({model, where}) {
          const metadata = getEntityMetadata(model)
          const entity = await orm.em.findOne(
            metadata.class,
            normalizeWhereClauses(metadata, where),
            {
              fields: ["id"]
            }
          )
          if (entity) {
            await orm.em.remove(entity).flush()
          }
        },
        async deleteMany({model, where}) {
          const metadata = getEntityMetadata(model)
          return orm.em.nativeDelete(
            metadata.class,
            normalizeWhereClauses(metadata, where)
          )
        }
      }
    }
  })
export {mikroOrmAdapter}
