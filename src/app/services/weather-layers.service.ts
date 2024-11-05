import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, lastValueFrom } from 'rxjs';

enum FeatureType {
  Feature = "Feature",
  FeatureCollection = "FeatureCollection"
}

interface Geometry {
  type: string;
  coordinates: number[][][][];
}

export enum SourceLayerType {
  FORECAST = 'forecast',
  EVENT = 'event',
  RADAR = 'radar'
}

export enum RadarLayerNames {
  RV = 'RainViewer Radar',
  NOAA = 'NOAA Radar'
}

export interface EventLayer {
  name: string;
  visible: boolean;
}

export interface ForecastLayer {
  name: string;
  visible: boolean;
  latitude: number;
  longitude: number;
}

export interface AlertApiResponse {
  "@context": any[];
  title: string;
  updated: string;
  type: FeatureType;
  features: AlertFeature[];
}

export interface AlertFeature {
  id: string;
  type: string;
  geometry: Geometry;
  properties: AlertProperties;
}

export interface AlertProperties {
  "@id": string;
  "@type": string;
  id: string;
  areaDesc: string;
  geocode: Geocode;
  affectedZones: string[];
  references: Reference[];
  sent: string;
  effective: string;
  onset: string;
  expires: string;
  ends: string;
  status: string;
  messageType: string;
  category: string;
  severity: string;
  certainty: string;
  urgency: string;
  event: string;
  sender: string;
  senderName: string;
  headline: string;
  description: string;
  instruction: string;
  response: string;
  parameters: AlertParameters;
}

export interface AlertParameters {
  AWIPSidentifier: string[];
  WMOidentifier: string[];
  NWSheadline: string[];
  BLOCKCHANNEL: string[];
  VTEC: string[];
  eventEndingTime: string[];
  expiredReferences: string;
}

export interface Reference {
  "@id": string;
  identifier: string;
  sender: string;
  sent: string;
}

export interface Geocode {
  SAME: string[];
  UGC: string[];
}

export interface GridPointResponse {
  "@context": Array<string | { "@version": string; wx: string; geo: string; unit: string; "@vocab": string }>;
  type: string;
  geometry: Geometry;
  properties: GridPointProperties;
}

export interface GridPointProperties {
  units: string;
  forecastGenerator: string;
  generatedAt: string;
  updateTime: string;
  validTimes: string;
  elevation: Elevation;
  periods: Period[];
}

export interface Elevation {
  unitCode: string;
  value: number;
}

export interface ProbabilityOfPrecipitation {
  unitCode: string;
  value: number | null;
}

export interface Period {
  number: number;
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: string;
  temperatureTrend: string;
  probabilityOfPrecipitation: ProbabilityOfPrecipitation;
  windSpeed: string;
  windDirection: string;
  icon: string;
  shortForecast: string;
  detailedForecast: string;
}

interface Frame {
  time: number;
  path: string;
}

interface RadarData {
  past: Frame[];
  nowcast: Frame[];
}

interface SatelliteData {
  infrared: Frame[];
}

export interface RainViewerApiData {
  version: string;
  generated: number;
  host: string;
  radar: RadarData;
  satellite: SatelliteData;
}

const eventLayersArr: EventLayer[] = [];

const radarLayersArr: EventLayer[] = [];

const forecastLayersArr: ForecastLayer[] = [
  { name: "Los Angeles", visible: true, latitude: 34.0522, longitude: -118.2437 },
  { name: "Seattle", visible: true, latitude: 47.6062, longitude: -122.3321 },
  { name: "Minneapolis", visible: true, latitude: 44.9778, longitude: -93.2650 },
  { name: "Kansas City", visible: true, latitude: 39.0997, longitude: -94.5786 },
  { name: "Miami", visible: true, latitude: 25.7617, longitude: -80.1918 },
  { name: "New York City", visible: true, latitude: 40.7128, longitude: -74.0060 },
  { name: "Salt Lake City", visible: true, latitude: 40.7608, longitude: -111.8910 },
  { name: "Dallas", visible: true, latitude: 32.7831, longitude: -96.8067 },
  { name: "Chicago", visible: true, latitude: 41.8781, longitude: -87.6298 },
  { name: "Phoenix", visible: true, latitude: 33.4484, longitude: -112.0740 },
  { name: "New Orleans", visible: true, latitude: 29.9511, longitude: -90.0715 },
  { name: "Ft. Belvoir", visible: true, latitude:38.7189, longitude: -77.1543}
];

@Injectable({
  providedIn: 'root'
})
export class WeatherLayersService {
  private forecastLayersSource = new BehaviorSubject<ForecastLayer[]>(forecastLayersArr);
  private eventLayersSource = new BehaviorSubject<EventLayer[]>(eventLayersArr);
  private radarLayersSource = new BehaviorSubject<EventLayer[]>(radarLayersArr);

  forecastLayers$ = this.forecastLayersSource.asObservable();
  eventLayers$ = this.eventLayersSource.asObservable();
  radarLayers$ = this.radarLayersSource.asObservable();

  constructor(private http: HttpClient) { }

  hasEvents(): boolean {
    return eventLayersArr.length > 0;
  }

  getEventLayers(): EventLayer[] {
    return this.eventLayersSource.value;
  }

  addRadarsToSource(radarName: string): void {
    const radarLayers = this.radarLayersSource.getValue();
    const newLayers = [
      ...radarLayers,
      {name: radarName, visible: radarName === RadarLayerNames.NOAA}
    ];

    this.radarLayersSource.next(newLayers);
  }

  addEventsToSource(eventData: AlertApiResponse): void {
    if (!eventData?.features) return;
    
    const features = eventData.features;
    const uniqueEvents = new Set<string>();
    const eventResults = features.filter(feature => {
      if(!feature.geometry){ return false; }
      const event = feature.properties.event;

      if (!uniqueEvents.has(event)) {
        uniqueEvents.add(event);
        return true;
      }

      return false;
    }).map(feature => ({
      name: feature.properties.event,
      visible: true
    }));

    const observedEventLayers = this.eventLayersSource.getValue();
    const mergedArray = eventResults.map(eventObj => {
      const eventExists = observedEventLayers.find(eventLayer => eventLayer.name === eventObj.name);

      if (eventExists) {
        const visible = eventExists.visible ? eventObj.visible : true;
        return {
          name: eventObj.name,
          visible: visible
        }
      } else {
        return eventObj;
      }
    });

    const cleanedEventLayers = observedEventLayers.filter(eventLayer =>
      eventResults.some(eventObj => eventObj.name === eventLayer.name)
    );

    const finalEventLayers = [
      ...cleanedEventLayers,
      ...mergedArray
    ];

    this.eventLayersSource.next(finalEventLayers);
  }

  toggleLayerVisibility(sourceType: SourceLayerType, layerName: string): void {
    if (sourceType === SourceLayerType.FORECAST) {
      const layers = this.forecastLayersSource.value;
      const updatedLayers: ForecastLayer[] = layers.map(layer =>
        layer.name === layerName ? { ...layer, visible: !layer.visible } : layer
      );
      this.forecastLayersSource.next(updatedLayers);

    } else if (sourceType === SourceLayerType.EVENT) {
      const layers = this.eventLayersSource.value;
      const updatedLayers: EventLayer[] = layers.map(layer =>
        layer.name === layerName ? { ...layer, visible: !layer.visible } : layer
      );
      this.eventLayersSource.next(updatedLayers);
    } else if (sourceType === SourceLayerType.RADAR) {
      const layers = this.radarLayersSource.value;
      const updatedLayers: EventLayer[] = layers.map(layer => 
        layer.name === layerName ? {...layer, visible: true} : {...layer, visible: false }
      );
      this.radarLayersSource.next(updatedLayers);
    }
  }

  getVisibleLayers(SourceType: SourceLayerType): ForecastLayer[] | EventLayer[] {
    const values = SourceType === SourceLayerType.EVENT ? this.eventLayersSource.value : this.forecastLayersSource.value;
    return values.filter(layer => layer.visible);
  }

  async getGridPoint(latitude: number, longitude: number): Promise<{ gridId: string, gridX: number, gridY: number } | undefined> {
    const url = `/weather/points/${latitude},${longitude}`;
    let gridPoint;

    try {
      const response = await lastValueFrom(this.http.get<any>(url));
      const gridX = response.properties.gridX;
      const gridY = response.properties.gridY;
      const gridId = response.properties.gridId;
  
      gridPoint = { gridId, gridX, gridY }
    } catch(error) {
      console.log('Error getting gridpoint');
    };

    return gridPoint;
  }

  async fetchRainViewerAPI(): Promise<RainViewerApiData | any> {
    const url = '/rvAPI';
    let response;

    try {
      response = await lastValueFrom(this.http.get(url));
    } catch(error) {
      console.log('Error fetching RainViewer Radar');
    }

    return response;
  }

  async fetchForecastData(gridPoint: { gridId: string, gridX: number, gridY: number }): Promise<GridPointResponse | any> {
    const url = `/weather/gridpoints/${gridPoint.gridId}/${gridPoint.gridX},${gridPoint.gridY}/forecast`;
    let response;

    try{
      response = await lastValueFrom(this.http.get(url));
    } catch(error) {
      console.log('Error fetching forecast for gridpoint');
    }

    return response;
  }

  async fetchHourlyForecastData(gridPoint: { gridId: string, gridX: number, gridY: number }): Promise<any> {
    const url = `/weather/gridpoints/${gridPoint.gridId}/${gridPoint.gridX},${gridPoint.gridY}/forecast/hourly`;
    let response;
    
    try{
      response = await lastValueFrom(this.http.get(url));
    } catch(error) {
      console.log('Error fetching hourly forecast for gridpoint');
    }

    return response;
  }

  async fetchEventData(): Promise<AlertApiResponse | any> {
    const url = '/weather/alerts/active';
    let response;
    
    try{
      response = await lastValueFrom(this.http.get(url));
    } catch(error) {
      console.log('Error fetching weather events');
    }

    return response;
  }
}
