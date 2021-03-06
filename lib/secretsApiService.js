const config = require('../config')
const AWS = require('aws-sdk');
const logger = require('../logger')
const Joi = require('joi');
const helpers = require('./snsServiceHelpers')
const stringNormalizer = require('string-normalizer')

AWS.config.update({region: config.AWS_REGION});

class SecretsApiService {
  constructor() {}

  async publishStoreEventFromArid(secret, arid) {
    let s3key = `arid/${arid}`;
    const aridData = await getRawArid(s3key)

    if (isAridExpired(aridData)) {
      logger.warn(`Request was made for expired Arid: ${arid}`)
      throw new Error('AridExpired')
    }
    return await this.publishStoreEvent(secret, aridData.rawApplication, aridData.userToken)
  }

  async publishStoreEvent(secret, application, userToken) {
    logger.info(`Publishing store secret event for user ${userToken}`)

    let response = {}, message = {}
    try {
      if (!config.STORE_SNS_TOPIC_NAME) {
        throw new Error('STORE_SNS_TOPIC_NAME environment variable missing!')
      }

      message = {
        action: 'store',
        secret: helpers.safeTrim(secret),
        rawApplication: helpers.safeTrim(application),
        normalizedApplication: stringNormalizer.normalizeString(application),
        userToken: userToken
      }
    
      // don't let the pw hints slip out in the logs
      let obfuscatedMessage = JSON.parse(JSON.stringify(message));
      obfuscatedMessage.secret = `(removed ${message.secret.length} chars)`
      logger.debug('Message:\n', obfuscatedMessage)
    }
    catch (err) {
      throw new Error(`Error building message: ${err}`)
    }

    try {
      validateStoreSNSMessage(message)
    }
    catch (err) {
      throw new Error(`Error validating message: ` + err)
    }
    
    try {
      await helpers.publishToSns(JSON.stringify(message), config.STORE_SNS_TOPIC_NAME)
    }
    catch (err) {
      throw new Error(`Error publishing message: ${err}`)
    }
  
    return response
  }

  // returns details about the request but not the secret
  async getAuthorizedRequest(arid) {
    logger.info(`Retrieving authorized request for ${arid}`)

    let s3key = `arid/${arid}`;
    const aridData = await getRawArid(s3key)

    if (isAridExpired(aridData)) {
      logger.warn(`Request was made for expired Arid: ${arid}`)
      throw new Error('AridExpired')
    }
  
    logger.debug(`Retrieved arid for ${aridData.normalizedApplication} from s3://${config.AUTHREQ_S3_BUCKET}/${s3key}`)
    return {
      expireEpoch: aridData.expireEpoch,
      userToken: aridData.userToken,
      rawApplication: aridData.rawApplication,
      normalizedApplication: aridData.normalizedApplication,
      isFirstTime: aridData.isFirstTime
    }
  }

  async publishRetrieveEventFromArid(arid) {
    let s3key = `arid/${arid}`;
    const aridData = await getRawArid(s3key)

    if (isAridExpired(aridData)) {
      logger.warn(`Request was made for expired Arid: ${arid}`)
      throw new Error('AridExpired')
    }
    return await this.publishRetrieveEvent(aridData.rawApplication, aridData.userToken)
  }

  async retrieveSecret(normalizedApplication, userToken) {
    logger.info(`Retrieving secret for ${userToken}, application: ${normalizedApplication}`)

    let s3key = applicationS3Key(normalizedApplication, userToken)

    if (!config.USERDATA_S3_SSEC_KEY || config.USERDATA_S3_SSEC_KEY.length < 32) {
      logger.error("S3 userdata SSE-C encryption key missing!")
    }
    const ssecKey = Buffer.alloc(32, config.USERDATA_S3_SSEC_KEY)

    let data
    try {
      const s3 = new AWS.S3();
      data = await s3.getObject({
        Bucket: config.USERDATA_S3_BUCKET,
        SSECustomerAlgorithm: 'AES256',
        SSECustomerKey: ssecKey,
        Key: s3key
      }).promise()
    }
    catch (err) {
      logger.error(`Error reading s3://${config.USERDATA_S3_BUCKET}/${s3key}:`, err)
      throw err
    }
    logger.debug(`Successfully read s3://${config.USERDATA_S3_BUCKET}/${s3key}`)

    let applicationData
    try {
      applicationData = JSON.parse(data.Body.toString())
    }
    catch (err) {
      logger.error(`Error parsing json for s3://${config.USERDATA_S3_BUCKET}/${s3key}`)
      throw err
    }

    logger.debug(`Retrieved secret (${applicationData.secret.length} chars) from s3://${config.USERDATA_S3_BUCKET}/${s3key}`)
    return {
      secret: applicationData.secret,
      rawApplication: applicationData.rawApplication
    } 
  }

}

async function getRawArid(s3key) {
  let data
  try {
    const s3 = new AWS.S3();
    data = await s3.getObject({
      Bucket: config.AUTHREQ_S3_BUCKET,
      Key: s3key
    }).promise()
  }
  catch (err) {
    logger.error(err)
    if (err.toString().includes('NoSuchKey')) {
      logger.debug(`S3 Key not found: s3://${config.AUTHREQ_S3_BUCKET}/${s3key}`)
      throw new Error('AridNotFound')
    }
    logger.error(`Error reading s3://${config.AUTHREQ_S3_BUCKET}/${s3key}:`, err)
    throw err
  }
  logger.debug(`Successfully read s3://${config.AUTHREQ_S3_BUCKET}/${s3key}`)

  let aridData
  try {
    aridData = JSON.parse(data.Body.toString())
  }
  catch (err) {
    logger.error(`Error parsing json for s3://${config.AUTHREQ_S3_BUCKET}/${s3key}`)
    throw err
  }

  // aridData data structure:
  // authorizedRequest = {
  //   expireEpoch,
  //   userToken,
  //   rawApplication,
  //   normalizedApplication
  // }

  return aridData
}
function isAridExpired(aridData) {
  const currentEpoch = Math.round((new Date).getTime() / 1000)
  if (currentEpoch > aridData.expireEpoch) {
      logger.debug(`Expired Arid encountered, current epoch: ${currentEpoch}, arid expire epoch: ${aridData.expireEpoch}`)
      return true;
  } else {
      return false;
  }
}

function validateStoreSNSMessage(message) {
  // NOTE: do not log message values here, raw secret/message passed in
  const schema = Joi.object().keys({
    action: Joi.string().valid('store').required(),
    secret: Joi.string().min(3).max(256).required(),
    rawApplication: Joi.string().min(2).max(256).required(),
    normalizedApplication: Joi.string().min(2).max(256).required(),
    userToken: Joi.string().min(20).max(100).required()
  })
  const result = Joi.validate(message, schema)
  if (result.error !== null) {
    const msg = "Store message object invalid: " + JSON.stringify(result)
    logger.error(msg)
    throw new Error(msg)
  }
  logger.info('Message validated OK')
}

function validateRetrieveSNSMessage(message) {
  const schema = Joi.object().keys({
    action: Joi.string().valid('retrieve').required(),
    rawApplication: Joi.string().min(2).max(256).required(),
    normalizedApplication: Joi.string().min(2).max(256).required(),
    userToken: Joi.string().min(20).max(100).required()
  })
  const result = Joi.validate(message, schema)
  if (result.error !== null) {
    const msg = "Retrieve message object invalid: " + JSON.stringify(result)
    logger.error(msg)
    throw new Error(msg)
  }
  logger.info('Message validated OK')
}

function userS3KeyPrefix(userToken) {
  return `users/${userToken}/data/`
}

function applicationS3Key(normalizedApplication, userToken) {
  return userS3KeyPrefix(userToken) + `${normalizedApplication}.json`
}

module.exports = SecretsApiService
