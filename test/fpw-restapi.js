'use strict';

const AWS = require('aws-sdk')

// tests for fpw-restapi
// Generated by serverless-mocha-plugin

const mochaPlugin = require('serverless-mocha-plugin');
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper('fpw-restapi', '/index.js', 'handler');

const validStoreEventData = require('../events/ValidStoreGatewayRequest.json')
const invalidStoreEventData = require('../events/InvalidStoreGatewayRequest.json')
const validRetrieveEventData = require('../events/ValidRetrieveGatewayRequest.json')
const invalidRetrieveEventData = require('../events/InvalidRetrieveGatewayRequest.json')
const validSendCodeEventData = require('../events/ValidSendCodeGatewayRequest.json')
const validNukeAccountEventData = require('../events/ValidNukeAccountGatewayRequest.json')

describe('fpw-restapi', () => {
  before((done) => {
    done();
  });

  it('/v1/secrets PUT (store) returns 200 for valid requests with valid confirmation code', async () => {
    await writeCodeToDynamo(1234, '6095551313', false)
    return wrapped.run(validStoreEventData).then((response) => {
      expect(response.statusCode).to.equal(200);
    });
  });

  it('/v1/secrets PUT (store) returns 401 for valid requests with invalid confirmation code', async () => {
    await writeCodeToDynamo(9999, '6095551313', false)
    return wrapped.run(validStoreEventData).then((response) => {
      expect(response.statusCode).to.equal(401);
    });
  });

  it('/v1/secrets PUT (store) returns 401 for valid requests with expired confirmation code', async () => {
    await writeCodeToDynamo(1234, '6095551313', true)
    return wrapped.run(validStoreEventData).then((response) => {
      expect(response.statusCode).to.equal(401);
    });
  });


  // it('/v1/secrets PUT (store) returns 400 for invalid requests with valid confirmation code', () => {
  //   // this doesn't seem to parse correctly on the other end...
  //   // let body = {
  //   //   hint: '',
  //   //   application: 'my app',
  //   //   phone: '609-555-1212'
  //   // }
  //   // let eventData.body = JSON.stringify(JSON.stringify(body))
  //   return wrapped.run(invalidStoreEventData).then((response) => {
  //     expect(response.statusCode).to.equal(400);
  //   });
  // });

  it('/v1/secrets POST (retrieve) returns 200 for valid requests', () => {
    return wrapped.run(validRetrieveEventData).then((response) => {
      expect(response.statusCode).to.equal(200);
    });
  });

  it('/v1/secrets POST (retrieve) returns 400 for invalid requests', () => {
    return wrapped.run(invalidRetrieveEventData).then((response) => {
      expect(response.statusCode).to.equal(400);
    });
  });

  it('/v1/codes POST (send) returns 200 for valid requests', () => {
    return wrapped.run(validSendCodeEventData).then((response) => {
      expect(response.statusCode).to.equal(200);
    });
  });

  it('/v1/nuke POST (send) returns 200 for valid requests', async () => {
    await writeCodeToDynamo(1234, '6095551414', false)
    return wrapped.run(validNukeAccountEventData).then((response) => {
      expect(response.statusCode).to.equal(200);
    });
  });

  it('/v1/nuke POST (send) returns 401 for valid requests with invalid confirmation code', async () => {
    await writeCodeToDynamo(1234, '6095551414', true)
    return wrapped.run(validNukeAccountEventData).then((response) => {
      expect(response.statusCode).to.equal(401);
    });
  });

});

async function writeCodeToDynamo(confirmationCode, normalizedPhone, isExpired) {
  const docClient = new AWS.DynamoDB.DocumentClient()

  // make sure it's a valid, not expired code
  let expireEpoch = null
  if (isExpired) {
    // make it already expired
    expireEpoch = (new Date).getTime() - 1000
  } else {
    expireEpoch = (new Date).getTime() + (1000 * 60 * 15)
  }
  expireEpoch = Math.round(expireEpoch / 1000)

  const params = {
      TableName:'fpw_confirmation_code',
      Item:{
          "NormalizedPhone": normalizedPhone,
          "Code": confirmationCode,
          "ExpireTime": expireEpoch
      }
  };

  console.log(`Storing confirmation code ${confirmationCode} to Dynamodb for ${normalizedPhone}...`)
  try {
    await docClient.put(params).promise()
  }
  catch (err) {
    console.error("Unable to write confirmation code to Dynamodb: ", JSON.stringify(err, null, 2))
    throw err
  }

}