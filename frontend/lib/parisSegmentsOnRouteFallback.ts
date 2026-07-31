/**
 * Local Paris segmentsOnRoute fallbacks when npm zwift-data has an empty list.
 * Used only when catalog.segmentsOnRoute is empty; safe to delete once upstream ships data.
 * Distances are km from route/Strava start (lead-in inclusive), matching zwift-data.
 */
export type SegmentsOnRoutePlacement = {
    from: number;
    to: number;
    segment: string;
};

export const PARIS_SEGMENTS_ON_ROUTE_FALLBACK: Record<string, SegmentsOnRoutePlacement[]> = {
    "heart-of-montmartre": [
        {
            "from": 0,
            "to": 6.615,
            "segment": "champs-elysees"
        },
        {
            "from": 1.171,
            "to": 1.324,
            "segment": "lutece-sprint"
        },
        {
            "from": 6.615,
            "to": 13.253,
            "segment": "champs-elysees"
        },
        {
            "from": 7.808,
            "to": 7.947,
            "segment": "lutece-sprint"
        },
        {
            "from": 13.253,
            "to": 19.874,
            "segment": "champs-elysees"
        },
        {
            "from": 14.43,
            "to": 14.584,
            "segment": "lutece-sprint"
        },
        {
            "from": 21.052,
            "to": 21.206,
            "segment": "lutece-sprint"
        },
        {
            "from": 22.621,
            "to": 22.908,
            "segment": "monceau-sprint"
        },
        {
            "from": 24.77,
            "to": 25.994,
            "segment": "montmartre-kom"
        },
        {
            "from": 28.543,
            "to": 28.708,
            "segment": "tchou-tchou-sprint"
        },
        {
            "from": 37.024,
            "to": 37.178,
            "segment": "lutece-sprint"
        },
        {
            "from": 38.577,
            "to": 38.881,
            "segment": "monceau-sprint"
        },
        {
            "from": 40.726,
            "to": 41.966,
            "segment": "montmartre-kom"
        },
        {
            "from": 44.518,
            "to": 44.664,
            "segment": "tchou-tchou-sprint"
        },
        {
            "from": 52.981,
            "to": 53.135,
            "segment": "lutece-sprint"
        },
        {
            "from": 54.533,
            "to": 54.838,
            "segment": "monceau-sprint"
        },
        {
            "from": 56.682,
            "to": 57.923,
            "segment": "montmartre-kom"
        },
        {
            "from": 60.474,
            "to": 60.62,
            "segment": "tchou-tchou-sprint"
        },
        {
            "from": 68.938,
            "to": 69.091,
            "segment": "lutece-sprint"
        }
    ],
    "la-boucle": [
        {
            "from": 1.178,
            "to": 1.33,
            "segment": "lutece-sprint"
        },
        {
            "from": 2.732,
            "to": 3.026,
            "segment": "monceau-sprint"
        },
        {
            "from": 4.882,
            "to": 6.11,
            "segment": "montmartre-kom"
        },
        {
            "from": 8.664,
            "to": 8.817,
            "segment": "tchou-tchou-sprint"
        }
    ],
    "montmartre-mixer": [
        {
            "from": 1.171,
            "to": 1.33,
            "segment": "lutece-sprint"
        },
        {
            "from": 2.726,
            "to": 3.023,
            "segment": "monceau-sprint"
        },
        {
            "from": 6.219,
            "to": 6.456,
            "segment": "eglise-sprint"
        },
        {
            "from": 10.528,
            "to": 10.836,
            "segment": "monceau-sprint"
        },
        {
            "from": 12.679,
            "to": 13.91,
            "segment": "montmartre-kom"
        },
        {
            "from": 15.95,
            "to": 17.182,
            "segment": "montmartre-kom"
        },
        {
            "from": 19.734,
            "to": 19.883,
            "segment": "tchou-tchou-sprint"
        }
    ],
    "double-espresso": [
        {
            "from": 1.174,
            "to": 1.326,
            "segment": "lutece-sprint"
        },
        {
            "from": 5.257,
            "to": 5.504,
            "segment": "eglise-sprint"
        },
        {
            "from": 7.573,
            "to": 8.803,
            "segment": "montmartre-kom"
        },
        {
            "from": 11.357,
            "to": 11.505,
            "segment": "tchou-tchou-sprint"
        },
        {
            "from": 15.678,
            "to": 15.829,
            "segment": "lutece-sprint"
        },
        {
            "from": 17.236,
            "to": 17.532,
            "segment": "monceau-sprint"
        },
        {
            "from": 19.387,
            "to": 20.616,
            "segment": "montmartre-kom"
        },
        {
            "from": 23.17,
            "to": 23.319,
            "segment": "tchou-tchou-sprint"
        }
    ],
    "paris-pacer": [
        {
            "from": 1.656,
            "to": 1.95,
            "segment": "monceau-sprint"
        },
        {
            "from": 3.806,
            "to": 5.036,
            "segment": "montmartre-kom"
        },
        {
            "from": 7.596,
            "to": 7.749,
            "segment": "tchou-tchou-sprint"
        },
        {
            "from": 10.687,
            "to": 10.935,
            "segment": "eglise-sprint"
        }
    ],
    "rues-in-rythme": [
        {
            "from": 1.35,
            "to": 1.597,
            "segment": "eglise-sprint"
        },
        {
            "from": 4.65,
            "to": 4.886,
            "segment": "lutece-sprint-rev"
        }
    ],
    "paris-toujours": [
        {
            "from": 0,
            "to": 6.613,
            "segment": "champs-elysees"
        },
        {
            "from": 1.171,
            "to": 1.32,
            "segment": "lutece-sprint"
        },
        {
            "from": 6.613,
            "to": 13.243,
            "segment": "champs-elysees"
        },
        {
            "from": 7.801,
            "to": 7.95,
            "segment": "lutece-sprint"
        },
        {
            "from": 13.243,
            "to": 19.86,
            "segment": "champs-elysees"
        },
        {
            "from": 14.419,
            "to": 14.578,
            "segment": "lutece-sprint"
        },
        {
            "from": 21.048,
            "to": 21.197,
            "segment": "lutece-sprint"
        },
        {
            "from": 27.043,
            "to": 27.298,
            "segment": "eglise-sprint"
        },
        {
            "from": 29.357,
            "to": 30.583,
            "segment": "montmartre-kom"
        },
        {
            "from": 33.134,
            "to": 33.291,
            "segment": "tchou-tchou-sprint"
        },
        {
            "from": 37.464,
            "to": 37.613,
            "segment": "lutece-sprint"
        },
        {
            "from": 43.46,
            "to": 43.714,
            "segment": "eglise-sprint"
        },
        {
            "from": 45.773,
            "to": 46.999,
            "segment": "montmartre-kom"
        },
        {
            "from": 49.55,
            "to": 49.708,
            "segment": "tchou-tchou-sprint"
        },
        {
            "from": 53.88,
            "to": 54.029,
            "segment": "lutece-sprint"
        },
        {
            "from": 59.876,
            "to": 60.117,
            "segment": "eglise-sprint"
        },
        {
            "from": 62.19,
            "to": 63.415,
            "segment": "montmartre-kom"
        },
        {
            "from": 65.966,
            "to": 66.124,
            "segment": "tchou-tchou-sprint"
        }
    ],
    "crepe-escape": [
        {
            "from": 1.179,
            "to": 1.329,
            "segment": "lutece-sprint"
        },
        {
            "from": 7.175,
            "to": 7.423,
            "segment": "eglise-sprint"
        },
        {
            "from": 9.491,
            "to": 10.72,
            "segment": "montmartre-kom"
        },
        {
            "from": 13.262,
            "to": 13.423,
            "segment": "tchou-tchou-sprint"
        }
    ],
    "loop-de-loop-de-loop": [
        {
            "from": 0,
            "to": 7.188,
            "segment": "champs-elysees"
        },
        {
            "from": 1.175,
            "to": 1.326,
            "segment": "lutece-sprint"
        },
        {
            "from": 3.105,
            "to": 3.401,
            "segment": "monceau-sprint"
        }
    ],
    "cirque-du-suffer": [
        {
            "from": 19.876,
            "to": 20.107,
            "segment": "lutece-sprint-rev"
        }
    ]
};
