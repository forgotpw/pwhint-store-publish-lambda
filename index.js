'use strict';

const PhoneTokenService = require('phone-token-service')
const SecretsApiService = require('./lib/secretsApiService')
const VerificationCodesService = require('./lib/verificationCodesService')
const NukeService = require('./lib/nukeService')
const logger = require('./logger')
const Joi = require('joi');
const config = require('./config')

const phoneTokenConfig = {
  tokenHashHmac: config.USERTOKEN_HASH_HMAC,
  s3bucket: config.USERTOKENS_S3_BUCKET,
  defaultCountryCode: 'US'
}

async function handler(event, context, done) {

  // raw console log output easier to copy/paste json from cloudwatch logs
  if (process.env.LOG_LEVEL == 'trace') {
    console.log(JSON.stringify(event))
  }

  let path = ''
  try {
    path = parsePath(event)
  }
  catch (err) {
    const msg = 'Error parsing path: ' + err
    return done(null, buildGatewayResponseFromError(err))
  }

  logger.trace(`event.httpMethod: ${event.httpMethod}, event.body: ${event.body}`)

  try {
    let response
    switch (path) {
      case '/v1/secrets':
        response = await secretsController(event, done)
        break
      case '/v1/codes':
        response = await codesController(event, done)
        break
      case '/v1/nuke':
        response = await nukeController(event, done)
        break
      default:
        throw new Error(`Unhandled path requested: ${path}`)
    }
    done(null, response)
  }
  catch (err) {
    done(null, buildGatewayResponseFromError(err))
  }
}

async function secretsController(event) {
  const phoneTokenService = new PhoneTokenService(phoneTokenConfig)
  const secretsApiService = new SecretsApiService()

  const body = JSON.parse(event.body)
  const userToken = await phoneTokenService.getTokenFromPhone(body.phone)

  switch (event.httpMethod) {
    case 'PUT':
      // validate payload
      const storeSchema = Joi.object().keys({
        application: Joi.string().min(2).max(256).required(),
        secret: Joi.string().min(3).max(256).required(),
        phone: Joi.string().min(10).max(32).required()
      })
      const storeResult = Joi.validate(body, storeSchema)
      if (storeResult.error !== null) {
        const msg = "Store secret payload invalid: " + JSON.stringify(storeResult)
        logger.error(msg)
        return gatewayResponse(400, msg)
      }
      const verificationCode = cleanHeaders(event.headers)['x-verificationcode']
      if (!verificationCode) {
        let msg = 'Verification code is not present'
        logger.warn(msg)
        logger.debug('HTTP Headers present: ' + JSON.stringify(event.headers))
        return gatewayResponse(401, msg)        
      }
      const verificationCodesService = new VerificationCodesService()
      let valid = await verificationCodesService.validateCode(
        verificationCode,
        userToken)
      if (!valid) {
        let msg = 'Verification code presented is not valid or is expired'
        logger.warn(msg)
        return gatewayResponse(401, msg)
      }
      await secretsApiService.publishStoreEvent(
        body.secret,
        body.application,
        userToken)
      return gatewayResponse(200, 'Successfully posted event')
    case 'POST':
      // validate payload
      const retrieveSchema = Joi.object().keys({
        application: Joi.string().min(2).max(256).required(),
        phone: Joi.string().min(10).max(32).required()
      })
      const retrieveResult = Joi.validate(body, retrieveSchema)
      if (retrieveResult.error !== null) {
        const msg = "Retrieve secret payload invalid: " + JSON.stringify(retrieveResult)
        logger.error(msg)
        return gatewayResponse(400, msg)
      }

      await secretsApiService.publishRetrieveEvent(
        body.application,
        userToken)
      return gatewayResponse(200, 'Successfully posted event')
    default:
      throw new Error(`Unhandled method requested: ${event.method}`)
  }
}

async function codesController(event) {
  const phoneTokenService = new PhoneTokenService(phoneTokenConfig)
  const verificationCodesService = new VerificationCodesService()

  const body = JSON.parse(event.body)
  const userToken = await phoneTokenService.getTokenFromPhone(body.phone)

  switch (event.httpMethod) {
    case 'POST':
      await verificationCodesService.publishSendCodeEvent(userToken)
      return gatewayResponse(200, 'Successfully posted event')
    default:
      throw new Error(`Unhandled method requested: ${event.method}`)
  }
}

async function nukeController(event) {
  const phoneTokenService = new PhoneTokenService(phoneTokenConfig)
  const nukeService = new NukeService()

  const body = JSON.parse(event.body)
  const userToken = await phoneTokenService.getTokenFromPhone(body.phone)

  switch (event.httpMethod) {
    case 'POST':
      const verificationCodesService = new VerificationCodesService()
      let valid = await verificationCodesService.validateCode(
        body.verificationCode,
        userToken)
      if (!valid) {
        let msg = 'Verification code presented is not valid or is expired'
        logger.warn(msg)
        return gatewayResponse(401, msg)
      }
      await nukeService.publishNukeAccountEvent(userToken)
      return gatewayResponse(200, 'Successfully posted event')
    default:
      throw new Error(`Unhandled method requested: ${event.method}`)
  }
}

function gatewayResponse(statusCode, message) {
  return {
    statusCode: statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Credentials': true,
    },
    body: JSON.stringify({
      message: message
    })
  }  
}

function buildGatewayResponseFromError(err) {
  const errMappings = [
    { httpStatus: 400, errStartsWith: 'Error validating message' },
    { httpStatus: 405, errStartsWith: 'Unhandled path requested' },
    { httpStatus: 405, errStartsWith: 'Unhandled method requested' }
  ]
  let statusCode = 500
  // surely there is a more efficient way but ...
  for (let errMapping of errMappings) {
    if (err.message.indexOf(errMapping.errStartsWith) > -1)
      statusCode = errMapping.httpStatus
      break
  }
  logger.error(err)
  return {
    statusCode: statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Credentials': true,
    },
    body: JSON.stringify({
      message: err
    })
  }
}

function parsePath(event) {
  let path = ''
  logger.trace('event.path: ', event.path)
  path = event.path.trim().toLowerCase()

  if (!path || path.length <= 0) {
    throw new Error('Path is unspecified')
  }
  return path
}

// convert all http headers to lower case as X-VerificationCode
// becomes x-verificationcode anyway, so as to avoid confusion,
// lower case them all 
function cleanHeaders(headers) {
  const cleaned = {}
  for (let key in headers) {
    cleaned[key.toLowerCase()] = headers[key]
  }
  return cleaned
} 


module.exports.handler = handler
