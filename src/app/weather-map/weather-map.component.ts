import { Component, AfterViewInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

import Map from 'ol/Map';
import View from 'ol/View';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import { fromLonLat } from 'ol/proj';
import TileLayer from 'ol/layer/Tile';
import { OSM } from 'ol/source';
import TileWMS from 'ol/source/TileWMS';
import { lastValueFrom } from 'rxjs';
import { GeoJSON } from 'ol/format';

import { WeatherLayersService, WeatherLayer, AlertApiResponse, GridPointResponse } from '../services/weather-layers.service';
import { MatIconModule } from '@angular/material/icon';
import Overlay from 'ol/Overlay';

@Component({
  selector: 'app-weather-map',
  standalone: true,
  templateUrl: './weather-map.component.html',
  styleUrl: './weather-map.component.scss',
  imports: [CommonModule, MatIconModule]
})
export class WeatherMapComponent implements AfterViewInit {

  private map!: Map;
  private overlay!: Overlay;
  private popupOpen: boolean = false;
  private USCenterLongLat: number[] = [-98.5795, 39.8283];

  weatherEvents: any[] = [];
  forecasts: any[] = [];

  constructor(private weatherLayersService: WeatherLayersService, private http: HttpClient) { }

  ngAfterViewInit(): void {
    this.initializeMap();
    this.weatherLayersService.layers$.subscribe(layers => { this.updateForecastLayers(); });
    this.loadForecastLayers();
    this.loadEventLayers();
    this.initOverlay();

    const closer = document.getElementById('popup-close');
    closer?.addEventListener('click', () => {
      this.closePopup();
    });

    this.addRadarOverlayLayer();
  }

  private initializeMap(): void {
    const osmLayer = new TileLayer({
      source: new OSM()
    });

    this.map = new Map({
      target: 'weather-map',
      layers: [osmLayer],
      view: new View({
        center: fromLonLat(this.USCenterLongLat),
        zoom: 5
      })
    });

    this.map.on('pointermove', (evt) => {
      const feature = this.map.forEachFeatureAtPixel(evt.pixel, (feat) => feat);

      if (feature) {
        const coords = evt.coordinate;
        this.popupOpen = true;
        this.showOverlay(coords, feature);
      } else if (!this.popupOpen) {
        this.overlay.setPosition(undefined);
      }
    });

    this.map.on('click', (evt) => {
      const feature = this.map.forEachFeatureAtPixel(evt.pixel, (feat) => feat);
      if (!feature) {
        this.closePopup();
      }
    });
  }

  private initOverlay(): void {
    const popupElement = document.getElementById('map-popup') as HTMLElement;

    if (popupElement) {
      this.overlay = new Overlay({
        element: popupElement,
        autoPan: false
      });

      this.map.addOverlay(this.overlay);
    }
  }

  private closePopup(): void {
    this.popupOpen = false;
    this.overlay.setPosition(undefined);
    const popupElement = document.getElementById('map-popup') as HTMLElement;
    if (popupElement) {
      popupElement.style.display = 'none';
    }
  }

  private addWeatherLayer(source: string, features: Feature[], layer?: WeatherLayer): void {
    const vectorSource = new VectorSource();
    const vectorLayer = new VectorLayer();

    vectorSource.addFeatures(features);
    vectorLayer.setSource(vectorSource);
    this.map.addLayer(vectorLayer);
  }

  private async getGridPoint(latitude: number, longitude: number): Promise<{ gridId: string, gridX: number, gridY: number }> {
    const url = `/weather/points/${latitude},${longitude}`;
    const response = await lastValueFrom(this.http.get<any>(url));
    const gridX = response.properties.gridX;
    const gridY = response.properties.gridY;
    const gridId = response.properties.gridId;

    return { gridId, gridX, gridY };
  }

  private async fetchForecastData(gridPoint: { gridId: string, gridX: number, gridY: number }): Promise<GridPointResponse | any> {
    const url = `/weather/gridpoints/${gridPoint.gridId}/${gridPoint.gridX},${gridPoint.gridY}/forecast`;
    const response = await lastValueFrom(this.http.get(url));

    return response;
  }

  private async loadForecastLayers(): Promise<void> {
    const visibleLayers = this.weatherLayersService.getVisibleLayers();

    for (const visibleLayer of visibleLayers) {
      const gridPoint = await this.getGridPoint(visibleLayer.latitude, visibleLayer.longitude);
      const forecastData: GridPointResponse = await this.fetchForecastData(gridPoint);
      const geoJSONFormat = new GeoJSON();
      const features = geoJSONFormat.readFeatures(forecastData, { featureProjection: 'EPSG:3857' });

      this.forecasts = forecastData.properties.periods;
      this.addWeatherLayer('forecast', features, visibleLayer);
    }
  }

  private async updateForecastLayers(): Promise<void> {
    if (this.map) {
      this.map.getLayers().forEach((layer) => {
        if (layer instanceof VectorLayer) {
          this.map.removeLayer(layer);
        }
      });

      await this.loadForecastLayers();
    }
  }

  private async fetchEventData(): Promise<AlertApiResponse | any> {
    const url = '/weather/alerts/active';
    const response = await lastValueFrom(this.http.get(url));

    return response;
  }

  private async loadEventLayers(): Promise<void> {
    const eventData: AlertApiResponse = await this.fetchEventData();
    const geoJSONFormat = new GeoJSON();
    const features = geoJSONFormat.readFeatures(eventData, { featureProjection: 'EPSG:3857' });

    this.weatherEvents = eventData.features;
    this.addWeatherLayer('events', features);
  }

  private showOverlay(coords: number[], feature: any): void {
    const overlayElement = this.overlay.getElement() as HTMLElement;
    const props = feature.getProperties();
    let content = '';

    if (props && props['@type'] === 'wx:Alert') {
      const {
        // areaDesc,
        // certainty,
        description,
        // effective,
        // ends,
        // event,
        expires,
        headline,
        // status,
        // urgency,
        // instruction,
        // onset
        severity
      } = props;

      content = `<p><b>${headline}</b></p>
                 <p>Severity: ${severity}</p>
                 <p>Expires: ${expires}</p>
                 <p>${description}</p>`;
    } else if (props && props.periods) {
      const period = props.periods[0];
      content = `<b>${period.name}</b>
                 <p>Temperature: ${period.temperature} ${period.temperatureUnit}</p>
                 <p>${period.shortForecast}</p>`;
    }

    if (overlayElement) {
      const popupContent = overlayElement.querySelector('#map-popup-content') as HTMLElement;
      if (popupContent) {
        popupContent.innerHTML = content;
        popupContent.scrollTop = 0;
        this.overlay.setPosition(coords);
        const popupElement = document.getElementById('map-popup') as HTMLElement;
        popupElement.style.display = 'block';
      }
    }
  }

  private addRadarOverlayLayer(): void {
    const url = '/noaa';
    const radarSource = new TileWMS({
      url: url,
      params: {
        'LAYERS': 'conus_bref_qcd',
        'TILED': true,
        'FORMAT': 'image/png',
        'STYLES': 'radar_reflectivity', // Add the style parameter
        'SRS': 'EPSG:3857', // Specify the SRS
        'TRANSPARENT': true // Make the layer transparent
      },
      serverType: 'geoserver' // Specify the server type if needed
    });
  
    const radarLayer = new TileLayer({
      source: radarSource,
      opacity: 0.6
    });
  
    this.map.addLayer(radarLayer);
  }

  @HostListener('window:resize', ['$event'])
  onWindowResize(): void {
    if (this.map) {
      this.map.updateSize();
    }
  }
}
