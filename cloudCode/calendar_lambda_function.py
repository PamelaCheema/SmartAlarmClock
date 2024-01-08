import json
import logging
import boto3
from datetime import datetime
import botocore

logger = logging.getLogger()
logger.setLevel(logging.INFO)

#check to see if there is already event data stored
def s3FileExists(filename, bucket):
    s3 = boto3.client('s3')
    try:
        s3.head_object(Bucket=bucket, Key=filename)
    except botocore.exceptions.ClientError as e:
        if e.response["Error"]["Code"] == "404":
            return False
        else:
            return True

def lambda_handler(event, context):
    s3 = boto3.resource('s3')
    bucket = 'set-get-ready-alarm-bucket'
    dest_filename = 'event_data.json'
    set_get_ready_alarm_bucket_obj = s3.Object(bucket, dest_filename)

    #calculate default alarm time if the (possible) previous event data and
    #new event data are not valid
    default_date = datetime.now()
    default_year = default_date.year
    default_month = default_date.month
    default_day = default_date.day
    default_hour = "08"
    default_min = "00"
    default_location = "
    default_event_name = "Event"

    default_start_time = f"{default_year}-{default_month}-{default_day}T{default_hour}:{default_min}:00"

    event_data_json = {}
    #if there was previous event data stored, then replace it if the new data is valid and set for an earlier time
    if s3FileExists(dest_filename, bucket):
        existing_file_data = read_json_from_s3(bucket, dest_filename)
        existing_start_time = existing_file_data["startTime"]
        existing_start_time_obj = datetime.fromisoformat(existing_start_time)
        default_start_time_obj =  datetime.fromisoformat(default_start_time)
        new_start_time_obj = datetime.fromisoformat(event["startTime"])
        if new_start_time_obj > existing_start_time_obj:
            event_data_json["startTime"] = event["startTime"]
            event_data_json["location"] = event["location"]
            event_data_json["eventName"] = event["eventName"]
        else:
            event_data_json["startTime"] = default_start_time
            event_data_json["location"] = default_location
            event_data_json["eventName"] = default_event_name
    #if neither event data is valid then store the default event data
    else:
        event_data_json["startTime"] = event["startTime"]
        event_data_json["location"] = event["location"]
        event_data_json["eventName"] = event["eventName"]

    #store data in bucket
    set_get_ready_alarm_bucket_obj.put(Body=json.dumps(event_data_json))
