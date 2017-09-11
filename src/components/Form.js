import React, { Component } from "react"
import Sugar from "../sugar"
import { without, uuid, getTypeName, handleFormEvent, onlyObjects } from "../utils"

function isNewResource() {
  return !!("_persisted" in this && !this._persisted)
}

export default class Form extends Component {
  constructor(...args) {
    super(...args);
    this.state = { submitting: false };
    this.fields = [];
    this.handleSubmit = this::this.handleSubmit;
    this.commitResource = this::this.commitResource;
    this.fieldsFor = this::this.fieldsFor;
    this.buildFieldProps = this::this.buildFieldProps;
  }

  render() {
    const { handleSubmit, state, buildFieldProps } = this,
          { for:resource, children } = this.props,
          submitting = resource._request.status.toString().match(/ING$/) || state.submitting,
          { schema={}, validations={} } = resource.constructor,
          props = this.props::without(
            "children", "for", "beforeValidation",
            "afterValidationFail", "beforeSave", "afterSave",
            "afterRollback", "builder"
          );

    const submit = {
      disabled: !!submitting
      // loading: !!submitting
    }
    if (!!submitting) {
      submit.children = "Saving";
    }

    const formObject = buildFieldProps(schema, validations, this, resource);

    return(
      <form {...props} ref={ ref => this.form = ref } onSubmit={handleSubmit}>
        {children({...formObject, submit })}
      </form>
    )
  }

  buildFieldProps(schema, validations, fieldsObj, resource={}) {
    const { fieldsFor } = this,
          defaultProps = { fieldsFor, ...this.applyBuilder(resource, fieldsObj) };

    return Object.keys(schema).reduce( (form, field) => {
      const type = schema[field]::getTypeName();
      if (type !== "Object" && !/^(_timestamps|_primaryKey|user_?[iI]d)$/.test(field)) {
        const fieldHumanizedAndTitleized = Sugar.String.titleize(Sugar.String.humanize(field));
        form[field] = form[field] || {
          ref: ref => (fieldsObj.fields[field] = ref),
          labelText: fieldHumanizedAndTitleized,
          defaultValue: resource[field]
        }
        if (resource._errors[field].length) form[field].errorText = resource._errors[field][0];
        if (validations && validations[field]) form[field].validators = validations[field];
      }

      return form;
    }, defaultProps)
  }

  applyBuilder(resource, fieldsObj) {
    if (typeof this.props.builder === "function") {
      const builder = this.props.builder(resource, fieldsObj);
      if (!onlyObjects(builder)) throw new TypeError(`Expected prop builder to return a plain object, got ${builder}`);
      return builder;
    }
    return {}
  }

  fieldsFor(resourceType, existingResource={}) {
    const { buildFieldProps } = this,
          { ReactiveRecord } = this.props.for,
          modelName = Sugar.String.camelize(Sugar.String.singularize(resourceType)),
          { schema, schema:{ _primaryKey="id" }, validations } = ReactiveRecord.model(modelName);

    const attributesName = `${resourceType}_attributes`,
          persisted = existingResource._persisted,
          idForFields = persisted ? existingResource[_primaryKey] : uuid(),
          fieldsObj = { fields:{}, _primaryKey, persisted };

    const formObject = buildFieldProps(schema, validations, fieldsObj, existingResource);

    this.fields[attributesName] = { ...this.fields[attributesName] }

    Object.defineProperty(this.fields[attributesName], "isValid", {
      value: function(callback) {
        let allFieldsValid = true,
            fieldsChecked = 0;
        const relevantFields = Object.keys(this.resources).reduce(( final, identifier)=>{
                const { fields } = this.resources[identifier],
                      attrs = Object.values(fields).filter(Boolean);
                return [...final, ...attrs ]
              },[]),
              fieldsToCheck = relevantFields.length,
              fieldValidator = isValid =>{
                fieldsChecked++;
                if (!isValid) allFieldsValid = false;
                if (fieldsChecked === fieldsToCheck) this::callback(allFieldsValid)
              };
        if (!relevantFields.length) return this::callback(true);
        relevantFields.map((field)=>{
          if (field.hasOwnProperty("isValid") ) return field.isValid(fieldValidator)
          return fieldValidator(true)
        })
      }
    })

    Object.defineProperty(this.fields[attributesName], "value", {
      get: function() {
        const isMany = resourceType === Sugar.String.pluralize(resourceType);

        return Object.keys(this.resources)
        .reduce( (finalValue, identifier) => {
          const { fields, _primaryKey, persisted } = this.resources[identifier],
                attrs = Object.keys(fields)
                              .filter(fieldName => !!fields[fieldName])
                              .reduce((final, currentValue)=>{
                                if (currentValue === "address") {
                                  Object.assign(final, fields[currentValue].value);
                                  return final
                                }
                                final[currentValue] = fields[currentValue].value === undefined ? fields[currentValue].getValue() : fields[currentValue].value;
                                return final;
                              }, {});

          if (persisted) attrs[_primaryKey] = identifier;
          if (isMany) {
            finalValue.push(attrs);
            return finalValue;
          }
          return attrs;
        }, isMany ? [] : {})
      }
    })

    this.fields[attributesName].resources = {
      ...this.fields[attributesName].resources,
      [idForFields]:fieldsObj
    }

    return fieldsFn => fieldsFn.call(this, formObject)

  }

  handleSubmit(e) {
    e.preventDefault();
    const { commitResource } = this;
    let allFieldsValid = true,
        fieldsChecked = 0;
    const relevantFields = Object.keys(this.fields).filter(fieldName => !!this.fields[fieldName]),
          fieldsToCheck = relevantFields.length,
          getFieldValues = () => {
            return relevantFields.reduce((final, currentValue)=>{
              if (typeof this.fields[currentValue].value === "function")
                return this.fields[currentValue].value(final)
              final[currentValue] = this.fields[currentValue].value;
              return final;
            }, {});
          },
          fieldValidator = isValid =>{
            // debugger;
            fieldsChecked++;
            if (!isValid) allFieldsValid = false;
            if (fieldsChecked === fieldsToCheck) {
              if (allFieldsValid) return this::handleFormEvent("beforeSave", getFieldValues()).then(commitResource)
              return this::handleFormEvent("afterFailValidation", getFieldValues())
            }
          };

    this::handleFormEvent("beforeValidation", this.fields).then(()=>{
      relevantFields.map((key)=>{
        if (this.fields[key] === null || !this.fields[key].isValid) return fieldValidator(true)
        return this.fields[key].isValid(fieldValidator)
      })
    })
  }

  commitResource(attrs) {
    if (this.props.for::isNewResource()) this.setState({ submitting: true })
    return this.props.for.updateAttributes(attrs)
                         .then( resource => {
                           if (this.state.submitting)
                             this.setState({ submitting: false })
                           this::handleFormEvent("afterSave", resource)
                         })
                         .catch( resource => {
                           if (this.state.submitting)
                             this.setState({ submitting: false })
                           this::handleFormEvent("afterRollback", resource)
                         })
  }

}
