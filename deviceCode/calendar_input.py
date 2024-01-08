from AWSIoTPythonSDK.MQTTLib import AWSIoTMQTTClient
import sys
import ssl
import json
import time
from datetime import date
from datetime import datetime, timedelta
from Foundation import NSPredicate
from EventKit import EKEventStore, EKEntityTypeEvent

#format date
def get_formatted_date(d):
    if d < 10:
        return "0{}".format(d)
    return d

# format time
def get_formmated_time(t):
    if t >= 1 and t <= 7:
        return t + 16
    else:
        return t - 8

def fetch_tmrw_events(start, end):
    # print("here")
    es = EKEventStore.alloc().init()
    es.requestAccessToEntityType_completion_(
        EKEntityTypeEvent, lambda granted, error: None
    )
    pred = es.predicateForEventsWithStartDate_endDate_calendars_(
        start, end, None
    )
    allEvents = es.eventsMatchingPredicate_(pred)
    curr_num_events = len(allEvents)
    if len(allEvents) > 0: #check if event exists for next day
        e = allEvents[0] #get the earliest event
        eventStartDate = e.startDate()
        eStart = datetime.utcfromtimestamp(eventStartDate.timeIntervalSince1970())
        formattedStartHour = get_formmated_time(eStart.hour)
        event_start_time_formatted = "{}-{}-{}T{}:{}:00".format(eStart.year, get_formatted_date(eStart.month), get_formatted_date(eStart.day), get_formatted_date(formattedStartHour), get_formatted_date(eStart.minute))
        event_location = str(e.location())
        event_json = {"startTime": event_start_time_formatted, "location": event_location, "send" : "true", "eventName" : e.title()}
        return event_json
    return None

if __name__ == "__main__":
    endpoint = ""
    cert = ""
    key = ""
    root_ca = ""
    msg_json = {}
    topic = "device/lambda/data"

    #configure client
    client = AWSIoTMQTTClient("MyIotThing")

    client.configureEndpoint(endpoint, 8883)
    client.configureCredentials(root_ca, key, cert)
    client.configureOfflinePublishQueueing(-1)
    client.configureDrainingFrequency(2)
    client.configureConnectDisconnectTimeout(10)
    client.configureMQTTOperationTimeout(5)

    last_json = None

    #continuosly check for new events
    while True:
        today = datetime.today()
        tmrw = today + timedelta(days=1)
        #check for new events for only the next day
        start_window_time = tmrw.replace(hour=0, minute=0, second=0)
        end_window_time = tmrw.replace(hour=23, minute=59, second=59)
        home = ""
        #default alarm time if nothing was found
        default_alarm_time = "{}-{}-{}T08:00:00".format(tmrw.year, get_formatted_date(tmrw.month), get_formatted_date(tmrw.day))
        #fetch any new events
        event_data_json = fetch_tmrw_events(start_window_time, end_window_time)
        #if new event was found then add event data to JSON obj to be sent to AWS IoT core
        if event_data_json != None:
            if event_data_json["location"] == "None":
                event_data_json["location"] = home
            msg_json["startTime"] = event_data_json["startTime"]
            msg_json["location"] = event_data_json["location"]
            msg_json["eventName"] = event_data_json["eventName"]
        #set the event data to the default alarm time otherwise
        else:
            msg_json["startTime"] = default_alarm_time
            msg_json["location"] = home
            msg_json["eventName"] = "wake up"
        #if the earliest event detected has not already been published, then publish the new event data
        if last_json != event_data_json:
            # print(event_data_json)
            print(msg_json)
            last_json = event_data_json
            msg = json.dumps(msg_json)
            # start connection
            client.connect()
            print("Connected to Client")
            #publish data to lambda function
            client.publish(topic, msg, 0)
            print("Published Message")

            #close connection
            client.disconnect()
            print("Disconnected from client")
