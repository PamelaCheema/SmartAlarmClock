
const Alexa = require('ask-sdk-core');
const AWS = require('aws-sdk');
const GOOGLE = require('@googlemaps/google-maps-services-js');
const googleApiKey = "";
const googleClient = new GOOGLE.Client({key: googleApiKey});

const s3 = new AWS.S3();
const bucket = 'set-get-ready-alarm-bucket'
const sourceFile = 'event_data.json'
const home = '';

const firstSet = new Set([1, 21, 31]);
const secondSet = new Set([2, 22]);
const thirdSet = new Set([3, 23]);
const months = ["January", "Februrary", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
let meridiem = "AM";

//get estimated time to travel from src to dest to arrive at arrival_time
async function getEstimatedTravelTime(src, dest, arrival_time, timestamp) {
  let ret = null;
  let travelResponse = await googleClient.directions({
    params: {
      origin: src,
      destination: dest,
      travelMode: 'DRIVING',
      key: googleApiKey,
      arrival_time: new Date(timestamp),
    },
    timeout: 1000
  })
  .then(r => {
    console.log(r['data']['routes'][0]['legs'][0]['duration']);
    ret = r['data']['routes'][0]['legs'][0]['duration'];
  })
  .catch(e => {
    console.log("error response: ", e.response);
  });
  return ret;
}

//subtract the original event start time by the estimated travel time
function getNewTravelStartTime(originalStartTime, travelTimeResponse) {
  let originalStartTimeObj = new Date(originalStartTime);
  let travelTime = travelTimeResponse['value'];
  originalStartTimeObj.setSeconds(originalStartTimeObj.getSeconds() - travelTime);
  console.log(`Travel time: ${travelTime}`);
  console.log(originalStartTimeObj);
  if (originalStartTimeObj < new Date()) {
    return null;
  } else {
    return originalStartTimeObj;
  }
  return originalStartTimeObj;
}

//get event data from JSON file in S# bucket
function getEventData() {
  const bucketInfo = {Bucket: bucket, Key: sourceFile};

  return new Promise((resolve, reject) => {
    s3.getObject(bucketInfo, function (err, data) {
      if (err) {
        console.log('Error reading file');
        reject(err);
      } else {
        const eventJSON = JSON.parse(data.Body.toString('utf-8'));
        resolve(eventJSON);
      }
    });
  });
}

function formattedDay(day) {
  if (firstSet.has(day)) {
    return day + "st";
  } else if (secondSet.has(day)) {
    return day + "nd";
  } else if (thirdSet.has(day)) {
    return day + "rd";
  } else {
    return day + "th";
  }
}

function formattedHour(hour) {
  if (hour > 12) {
    meridiem = "PM";
    return hour - 12;
  } else {
    meridiem = "AM";
    return hour;
  }
}

function formattedMonth(month) {
  return months[month];
}

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  async handle(handlerInput) {
        const { requestEnvelope, serviceClientFactory } = handlerInput;

        try {
            const eventData = await getEventData();
            let eventStartTime = eventData['startTime'];
            const eventLocation = eventData['location'];
            let eventStartTimeObj = null;
            let travelTimeResponse = null;
            if (eventLocation != home) {
              travelTimeResponse = await getEstimatedTravelTime(home, eventLocation, eventStartTime);
            }

            if (travelTimeResponse != null) {
              eventStartTimeObj = getNewTravelStartTime(eventStartTime, travelTimeResponse);
            } else {
              console.log("travel time response is null");
            }

            //if the optimal start time for the alarm has already passed, then annouce to user that their event has either passed or they should already be heading to their event
            if (eventStartTimeObj == null) {
              return handlerInput.responseBuilder
                  .speak(`Your event start time has either already passed or you should already head to your event based on current traffic conditions. Estimated travel time is ${travelTimeResponse['text']}`)
                  .getResponse();
            }

            //get start time details to format properly
            let eventStartHours = eventStartTimeObj.getHours();
            let eventStartMins = eventStartTimeObj.getMinutes();
            let eventDay = eventStartTimeObj.getDate();
            let eventMonth = eventStartTimeObj.getMonth();
            let eventYear = eventStartTimeObj.getFullYear();
            let eventName = eventData['eventName'];

            if (eventStartHours < 10) {
              eventStartHours = `0${eventStartHours}`;
            }

            eventStartTime = `${eventYear}-${eventMonth+1}-${eventDay}T${eventStartHours}:${eventStartMins}:00`;

            console.log(`new event start time: ${eventStartTime}`);

            //set reminder
            const reminderAlertInfo = {
              requestTime: new Date().toISOString(),
              trigger: {
                type: 'SCHEDULED_ABSOLUTE',
                scheduledTime: eventStartTime,
                timeZoneId: 'America/Los_Angeles',
              },
              alertInfo: {
                spokenInfo: {
                  content: [{
                    locale: 'en-US',
                    text: eventName,
                  }],
                },
              },
              pushNotification: {
                status: 'ENABLED',
              },
            };

            const reminderClient = serviceClientFactory.getReminderManagementServiceClient();

            const {alertToken} = await reminderClient.createReminder(reminderAlertInfo);

            const output = `Your reminder for your event: ${eventName} has been set for ${formattedHour(eventStartHours)}:${eventStartMins} ${meridiem} on ${formattedMonth(eventMonth)} ${formattedDay(eventDay)}, ${eventYear}`;

            return handlerInput.responseBuilder
                .speak(output)
                .getResponse();
        } catch (error) {
            console.error('Error setting reminder:', error);
            const output = `Sorry, there was an error setting the reminder.`;
            return handlerInput.responseBuilder
                .speak(output)
                .getResponse();
        }
    },
};

exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
      LaunchRequestHandler
    ).withApiClient(new Alexa.DefaultApiClient())
    .lambda();
