import { Children } from "react"
import Collection from "../ReactiveRecord/Collection"
import {
  where,
  select,
  onlyReactiveRecord,
  queryStringToObj,
  values,
  pick,
  without
} from "../utils"

function defaultSelect() {
  return true
}

export function mapStateToProps(
  state,
  { for: Model, find, where: _where, select: _select = defaultSelect }
) {
  const {
      store: { singleton },
      schema: { _primaryKey = "id" },
      displayName
    } = Model,
    stateModels = state::onlyReactiveRecord()

  let whereQuery = _where
    ? typeof _where === "string"
      ? queryStringToObj(_where)
      : _where
    : {}
  const schemaAttrs = Object.keys(
    Model.schema::without("_primaryKey", "_timestamps")
  )
  whereQuery = whereQuery::pick(...schemaAttrs)

  if (singleton || find) {
    if (singleton) {
      return {
        resource: new Model(
          {
            ...stateModels[displayName]._attributes,
            _errors: stateModels[displayName]._errors,
            _request: stateModels[displayName]._request
          },
          true,
          true
        )
      }
    }
    const member = stateModels[displayName]._collection[find]
    if (member) {
      return {
        resource: new Model(
          {
            ...member._attributes,
            _errors: member._errors,
            _request: member._request
          },
          true,
          true
        )
      }
    }
    return { resource: new Model({ _request: { status: null } }, false, true) }
  }

  const { _collection, _request } = stateModels[displayName],
    transformedCollection = _collection
      ::values()
      .map(
        ({ _attributes, _request, _errors }) =>
          new Model(
            {
              ..._attributes,
              _errors,
              _request
            },
            true,
            true
          )
      )
      ::where(whereQuery)
      ::select(_select)
  return {
    resource: new Collection({
      _collection: transformedCollection,
      _request,
      _primaryKey
    })
  }
}

export const areStatePropsEqual = (prev, next) => {
  return (
    JSON.stringify(prev.resource.serialize()) ===
    JSON.stringify(next.resource.serialize())
  )
}

export const areStatesEqual = ({ for: { displayName } }) => (prev, next) => {
  return (
    prev::onlyReactiveRecord()[displayName] ===
    next::onlyReactiveRecord()[displayName]
  )
}

export function ReactiveResource({ children, resource }) {
  return Children.only(children(resource))
}
ReactiveResource.displayName = "ReactiveResource"
