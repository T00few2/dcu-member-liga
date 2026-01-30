import logging
from datetime import datetime

logger = logging.getLogger('ZwiftFetcher')

class ZwiftFetcher:
    def __init__(self, zwift_service):
        self.zwift = zwift_service

    def get_event_info(self, event_id, event_secret):
        return self.zwift.get_event_info(event_id, event_secret)

    def extract_subgroups(self, event_info):
        result = []
        event_name = event_info.get("name", "")
        for subgroup in event_info.get("eventSubgroups", []):
            result.append({
                "id": subgroup.get("id"),
                "eventName": event_name,
                "subgroupLabel": subgroup.get("subgroupLabel"),
                "routeId": subgroup.get("routeId"),
                "laps": subgroup.get("laps"),
                "eventSubgroupStart": subgroup.get("eventSubgroupStart"),
            })
        return result

    def fetch_finishers(self, subgroup_id, event_secret, fetch_mode, filter_registered, registered_riders):
        """
        Fetches participants/finishers for a subgroup and maps them to registered riders.
        """
        finishers = []
        if fetch_mode == 'finishers':
            finish_results_raw = self.zwift.get_event_results(subgroup_id, event_secret=event_secret)
            
            for entry in finish_results_raw:
                profile = entry.get('profileData', {})
                zid = str(profile.get('id') or entry.get('profileId'))
                
                # Helper to build finisher object
                finisher = {
                    'zwiftId': zid,
                    'finishTime': entry.get('activityData', {}).get('durationInMilliseconds', 0),
                    'flaggedCheating': entry.get('flaggedCheating', False),
                    'flaggedSandbagging': entry.get('flaggedSandbagging', False),
                    'criticalP': entry.get('criticalP', {})
                }

                if zid in registered_riders:
                    finisher['name'] = registered_riders[zid].get('name')
                    finisher['info'] = registered_riders[zid]
                    finishers.append(finisher)
                elif not filter_registered:
                    finisher['name'] = f"{profile.get('firstName', '')} {profile.get('lastName', '')}".strip()
                    finisher['info'] = {}
                    finishers.append(finisher)
            
            finishers.sort(key=lambda x: x['finishTime'])
            
        else:
            is_joined = (fetch_mode == 'joined')
            participants_raw = self.zwift.get_event_participants(subgroup_id, joined=is_joined)
            
            for p in participants_raw:
                zid = str(p.get('id'))
                finisher = {
                    'zwiftId': zid,
                    'finishTime': 0,
                    'flaggedCheating': False,
                    'flaggedSandbagging': False,
                    'criticalP': {}
                }

                if zid in registered_riders:
                    finisher['name'] = registered_riders[zid].get('name')
                    finisher['info'] = registered_riders[zid]
                    finishers.append(finisher)
                elif not filter_registered:
                    finisher['name'] = f"{p.get('firstName', '')} {p.get('lastName', '')}".strip()
                    finisher['info'] = {}
                    finishers.append(finisher)
            
            finishers.sort(key=lambda x: x['name'])
            
        return finishers

    def fetch_segment_efforts(self, segment_ids, start_time, end_time):
        """
        Fetches results for a list of segments within a time window.
        Returns a dictionary: { segment_id: raw_results }
        """
        results = {}
        for seg_id in segment_ids:
            try:
                raw = self.zwift.get_segment_results(seg_id, from_date=start_time, to_date=end_time)
                results[seg_id] = raw
            except Exception as e:
                logger.error(f"Failed to fetch segment {seg_id}: {e}")
        return results
