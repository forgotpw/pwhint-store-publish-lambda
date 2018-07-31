'use strict';

const PwhintApiService = require('./pwhintApiService/pwhintApiService')
const logger = require('./logger')

async function handler(event, context, done) {

  logger.debug('Received event:', event)

  const pwhintApiService = new PwhintApiService()
  
  switch (event.method) {
    case 'PUT':
      let response = await pwhintApiService.publishStoreEvent(
        event.body.hint,
        event.body.application,
        event.body.phone
      )
      done(null, response)
      break
    default:
      done(null, {
        statusCode: 500,
        body: JSON.stringify({
          message: `Unhandled API request method: ${event.method}`
        })
      })
      break
  }
};

module.exports.handler = handler
