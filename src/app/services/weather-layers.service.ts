import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

enum FeatureType {
  Feature = "Feature",
  FeatureCollection = "FeatureCollection"
}

interface Geometry {
  type: string;
  coordinates: number[][][][];
}

export interface WeatherLayer {
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

const wfoLocations: WeatherLayer[] = [
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
];

@Injectable({
  providedIn: 'root'
})
export class WeatherLayersService {
  private layersSource = new BehaviorSubject<WeatherLayer[]>(wfoLocations);
  
  layers$ = this.layersSource.asObservable();

  constructor() { }

  toggleLayerVisibility(layerName: string): void {
    const layers = this.layersSource.value;
    const updatedLayers = layers.map(layer =>
      layer.name === layerName ? { ...layer, visible: !layer.visible } : layer
    );

    this.layersSource.next(updatedLayers);
  }

  getVisibleLayers(): WeatherLayer[] {
    return this.layersSource.value.filter(layer => layer.visible);
  }
}
