var gcm = require('node-gcm');
var apn = require('apn');
var mpns = require('mpns');
var adm = require('node-adm');
var Parallel = require('node-parallel');
var _ = require('lodash');

var settings = {
  gcm: {
    id: null, // PUT YOUR GCM SERVER API KEY,
    options: {},
    msgcnt: 1,
    dataDefaults: {
      delayWhileIdle: false,
      timeToLive: 4 * 7 * 24 * 3600, // 4 weeks
      retries: 4
    }
  },
  apn: {
    gateway: 'gateway.sandbox.push.apple.com',
    badge: 1,
    defaultData: {
      expiry: 4 * 7 * 24 * 3600, // 4 weeks
      sound: 'ping.aiff'
    }
  },
  adm: {
    client_id: null, // PUT YOUR ADM CLIENT ID,
    client_secret: null, // PUT YOUR ADM CLIENT SECRET,
    expiresAfter: 4 * 7 * 24 * 3600, // 4 weeks
  }
};

function PushNotifications(options) {
  _.extend(settings, options);
}

PushNotifications.prototype.send = function (pushId, data, callback) {
  var GCMSender = new gcm.Sender(settings.gcm.id, settings.gcm.options);
  var APNConnection = new apn.Connection(settings.apn);
  var ADMSender = new adm.Sender(settings.adm);

  var regIdsGCM = [];
  var regIdsAPN = [];
  var regIdsMPNS = [];
  var regIdsADM = [];

  var messageGCM = '';
  var messageAPN = '';

  var apnsResult = {
      failure: 0,
      success: 0,
      results: []
  };

  var parallel = new Parallel();
  parallel.timeout(10000);

  if (pushId instanceof Array) {

  } else if (pushId.length) {
    pushId = [pushId];
  } else {
    pushId = [];
  }

  for (i = 0; i < pushId.length; i++) {
    if (pushId[i].substring(0, 4) === 'http') {
      regIdsMPNS.push(pushId);
    } else if (pushId[i].length > 64) {
      regIdsGCM.push(pushId[i]);
    } else if (pushId[i].length === 64) {
      regIdsAPN.push(pushId[i]);
    } else if (true) { // need to find condition for amazon token
      regIdsADM.push(pushId[i]);
    }
  }

  // Android GCM
  if (regIdsGCM[0] != undefined) {
    data = _.extend({
      data: data
    }, settings.gcm.dataDefaults);
    messageGCM = new gcm.Message(data);
    messageGCM.addData('msgcnt', settings.gcm.msgcnt);

    parallel.add(function (done) {
      GCMSender.send(messageGCM, regIdsGCM, settings.gcm.retries, function (err, result) {
        if (err) {
          done({
            device: 'android',
            message: err
          });
        } else {
          done(null, {
            device: 'android',
            result: result
          });
        }
      });
    })
  }

  // iOS APN
  if (regIdsAPN[0] != undefined) {
    messageAPN = new apn.Notification();
    _.extend(messageAPN, settings.apn.defaultData);
    messageAPN.expiry = Math.floor(Date.now() / 1000) + settings.apn.expiry;
    messageAPN.badge = settings.apn.badge;
    messageAPN.sound = settings.apn.defaultData.sound;
    messageAPN.alert = data.title;
    delete data.title;
    messageAPN.payload = data;

    APNConnection.pushNotification(messageAPN, regIdsAPN);

    parallel.add(function (done) {
      APNConnection.on('completed', function () {
        done(
          null, {
          device: 'ios',
          result: apnsResult
        });
      });
      APNConnection.on('transmitted', function(notification, device) {
        apnsResult.success = apnsResult.success + 1;
        apnsResult.results.push({registration_id: device});
      });
      APNConnection.on('error', function () {
        done({
          device: 'ios',
          message: 'error'
        });
      });
      APNConnection.on('socketError', function () {
        done({
          device: 'ios',
          message: 'socketError'
        });
      });
      APNConnection.on('transmissionError', function(errCode, notification, device) {
        apnsResult.failure = apnsResult.failure + 1;
        apnsResult.results.push({error: errCode, registration_id: device});
      });
      APNConnection.on('cacheTooSmall', function () {
        done({
          device: 'ios',
          message: 'cacheTooSmall'
        });
      });
    })
  }

  // Microsoft MPNS
  for (i = 0; i < regIdsMPNS.length; i++) {
    var tempMPNS = regIdsMPNS[i];
    parallel.add(function (done) {
      mpns.sendToast(tempMPNS, data.title, data.message, data, function (err) {
        if (err === undefined) {
          done(0, 1);
        } else {
          done({
            device: 'windows phone',
            message: err
          });
        }
      });
    })
  }

  // Amazon AMZ
  var AMZmesssage = {
    data: data,
    consolidationKey: 'demo',
    expiresAfter: Math.floor(Date.now() / 1000) + settings.adm.expiresAfter // 1 hour
  }

  for (i = 0; i < regIdsADM.length; i++) {
    var tempADM = regIdsADM[i];
    parallel.add(function (done) {
      ADMSender.send(AMZmesssage, tempADM, function (err, result) {
        if (err) {
          // No recoverable error
          done({
            device: 'amazon phone',
            message: err
          });
        }
        if (result.error) {
          // ADM Server error such as InvalidRegistrationId
          done({
            device: 'amazon phone',
            message: result.error
          });
        } else if (result.registrationID) {
          done(0, 1);
        }
      });
    })
  }

  parallel.done(function (err, results) {
    if (err) {
      callback(err);
    } else {
      callback(null, results);
    }
  })
};

module.exports = PushNotifications;
