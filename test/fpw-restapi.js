'use strict';

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

describe('fpw-restapi', () => {
  before((done) => {
    done();
  });

  it('/v1/secrets PUT (store) returns 200 for valid requests', () => {
    return wrapped.run(validStoreEventData).then((response) => {
      expect(response.statusCode).to.equal(200);
    });
  });

  it('/v1/secrets PUT (store) returns 400 for invalid requests', () => {
    // this doesn't seem to parse correctly on the other end...
    // let body = {
    //   hint: '',
    //   application: 'my app',
    //   phone: '609-555-1212'
    // }
    // let eventData.body = JSON.stringify(JSON.stringify(body))
    return wrapped.run(invalidStoreEventData).then((response) => {
      expect(response.statusCode).to.equal(400);
    });
  });

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

});
