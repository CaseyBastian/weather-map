import { Component, AfterViewInit, HostListener, OnDestroy, Renderer2 } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Subject, takeUntil } from 'rxjs';

import { Map as OLMap } from 'ol';
import View from 'ol/View';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature, { FeatureLike } from 'ol/Feature';
import { fromLonLat } from 'ol/proj';
import TileLayer from 'ol/layer/Tile';
import { OSM, XYZ } from 'ol/source';
import TileWMS from 'ol/source/TileWMS';
import { GeoJSON } from 'ol/format';
import Overlay from 'ol/Overlay';
import { Style, Fill, Stroke } from 'ol/style';

import {
  WeatherLayersService,
  SourceLayerType,
  EventLayer,
  ForecastLayer,
  AlertApiResponse,
  GridPointResponse,
  RadarLayerNames,
  RainViewerApiData
} from '../services/weather-layers.service';
import { InfoPanelService, InfoType } from '../services/info-panel.service';

enum EventSeverityScale {
  MINOR = "0, 255, 0",
  MODERATE = "255, 255, 0",
  SEVERE = "255, 165, 0", 
  EXTREME = "255, 69, 0"
}

const projection = 'EPSG:3857';

@Component({
  selector: 'app-weather-map',
  standalone: true,
  templateUrl: './weather-map.component.html',
  styleUrl: './weather-map.component.scss',
  imports: [CommonModule, MatIconModule]
})
export class WeatherMapComponent implements AfterViewInit, OnDestroy {
  private destroy$ = new Subject<void>();

  private map!: OLMap;
  private overlay!: Overlay;
  private popupOpen: boolean = false;
  private USCenterLongLat: number[] = [-98.5795, 39.8283];
  private reloadIntervalId: any;
  private iconOverlayMap: Map<string, Overlay> = new Map();
  private forecastVectorLayerMap: Map<string, VectorLayer> = new Map();
  private eventVectorLayerMap: Map<string, VectorLayer> = new Map();
  private eventVisibilityState: Map<string, boolean> = new Map();
  private forecastVisibilityState: Map<string, boolean> = new Map();
  private radarVisibilityState: Map<string, boolean> = new Map(); 
  private radarTileLayerMap: Map<string, TileLayer> = new Map();

  constructor(
    private weatherLayersService: WeatherLayersService,
    private infoPanelService: InfoPanelService,
    private renderer: Renderer2
  ) {}

  ngAfterViewInit(): void {

    this.initializeMap();
    this.loadForecastLayers();
    this.loadEventLayers();

    this.weatherLayersService.eventLayers$
      .pipe(takeUntil(this.destroy$))
      .subscribe(eventLayers => { this.toggleEventLayers(eventLayers); });
    this.weatherLayersService.forecastLayers$
      .pipe(takeUntil(this.destroy$))
      .subscribe(forecastLayers => { this.toggleForecastLayers(forecastLayers); });
    this.weatherLayersService.radarLayers$
      .pipe(takeUntil(this.destroy$))
      .subscribe(radarLayers => {this.toggleRadarLayers(radarLayers); });

    setTimeout(() => {
      this.addNOAARadarLayer();
      this.addRVRadarLayer();
    });

    this.reloadIntervalId = setInterval(() => {
      console.log('Interval Refresh');
    }, 300000);
  }

  ngOnDestroy(): void {
    if (this.reloadIntervalId) {
      clearInterval(this.reloadIntervalId);
    }

    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeMap(): void {
    const osmLayer = new TileLayer({
      source: new OSM()
    });

    this.map = new OLMap({
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
        this.highlightEventLayer(feature);
        this.showInfoPanel(feature);
      }
    });

    this.map.on('click', (evt) => {
      const feature = this.map.forEachFeatureAtPixel(evt.pixel, (feat) => feat);
      if (!feature) {
        this.infoPanelService.setInfoPanelVisibility(false);
        this.eventVectorLayerMap.forEach(vectorLayer => {
          const layerFeatures = vectorLayer.getSource()?.getFeatures();
          layerFeatures?.forEach(layerFeature => {
            const defaultStyle = this.styleEvent(layerFeature);
            layerFeature.setStyle(defaultStyle);
          });
        });
      }
    });
  }

  private addForecastLayer(layerName: string, features: Feature[], hourlyForecast: any, visible: boolean = true): void {
    const vectorSource = new VectorSource({
      features: features.map(feature => {
        feature.setProperties({
          ...feature.getProperties(),
          locationName: layerName,
          hourlyForecast: hourlyForecast
        });

        return feature;
      })
    });

    let vectorLayer = this.forecastVectorLayerMap.get(layerName);

    if (vectorLayer) {
      vectorLayer.setVisible(visible);
    } else {
      vectorLayer = new VectorLayer({
        source: vectorSource,
        visible: visible,
        
      });

      this.map.addLayer(vectorLayer);
      this.forecastVectorLayerMap.set(layerName, vectorLayer);
    }

    this.forecastVisibilityState.set(layerName, visible);

    const extent = vectorSource.getExtent();
    const center = [
      (extent[0]+extent[2]) /2,
      (extent[1]+extent[3]) /2
    ];

    this.createIconOverlay(layerName, center, visible);
  }

  private createIconOverlay(layerName: string, center:number[], visible: boolean){
    let iconOverlay = this.iconOverlayMap.get(layerName);

    if(iconOverlay) {
      const iconElement = iconOverlay.getElement();

      if(iconElement){
        iconElement.style.display = visible ? 'block' : 'none';
      }
      iconOverlay.setPosition(center);
    } else {
      const iconElement = this.renderer.createElement('div');

      this.renderer.setStyle(iconElement, 'position', 'absolute');
      this.renderer.setStyle(iconElement, 'transform', 'translate(-30%, -50%)');

      const placeIcon = this.renderer.createElement('mat-icon');

      this.renderer.setStyle(placeIcon, 'color', layerName === 'Ft. Belvoir' ? 'blueviolet' : 'blue');
      this.renderer.setStyle(placeIcon, 'fontSize', '18px');
      this.renderer.appendChild(placeIcon, this.renderer.createText('place'));
      this.renderer.addClass(placeIcon, 'mat-icon');
      this.renderer.addClass(placeIcon, 'material-icons');
      this.renderer.appendChild(iconElement, placeIcon);

      this.renderer.listen(iconElement, 'click', (evt) => {
        const features = this.getInfoPanelFeature(layerName)[0];
  
        if (features) {
          this.showInfoPanel(features);
        }
      });

      const newIconOverlay = new Overlay({
        element: iconElement,
        positioning: 'bottom-center'
      });

      newIconOverlay.setPosition(center);
      this.map.addOverlay(newIconOverlay);
      this.iconOverlayMap.set(layerName, newIconOverlay);
    }
    
    this.toggleIconVisibility(layerName, visible);

  }

  private async loadForecastLayers(): Promise<void> {
    const visibleLayers: ForecastLayer[] = this.weatherLayersService.getVisibleLayers(SourceLayerType.FORECAST) as ForecastLayer[];

    for (const visibleLayer of visibleLayers) {
      const gridPoint = await this.weatherLayersService.getGridPoint(visibleLayer.latitude, visibleLayer.longitude);
      const forecastData: GridPointResponse = await this.weatherLayersService.fetchForecastData(gridPoint);
      const geoJSONFormat = new GeoJSON();
      const features = geoJSONFormat.readFeatures(forecastData, { featureProjection: projection });
      const hourlyForecast = await this.weatherLayersService.fetchHourlyForecastData(gridPoint);
      this.addForecastLayer(
        visibleLayer.name,
        features,
        hourlyForecast?.properties?.periods ? hourlyForecast.properties.periods.slice(0, 6) : null,
        visibleLayer.visible
      );

      this.delayResolve(500);
    }
  }

  private toggleIconVisibility(layerName: string, visible: boolean): void {
    const iconOverlay = this.iconOverlayMap.get(layerName);
    if(iconOverlay) {
      const iconElement = iconOverlay.getElement();
      if(iconElement){
        iconElement.style.display = visible ? 'block' : 'none';
      }
    }
  }

  private async toggleForecastLayers(forecastLayers: ForecastLayer[]): Promise<void> {
    if (this.map) {
      forecastLayers.forEach(forecastLayer => {
        const vectorLayer = this.forecastVectorLayerMap.get(forecastLayer.name);

        if (vectorLayer) {
          vectorLayer.setVisible(forecastLayer.visible);
          this.forecastVisibilityState.set(forecastLayer.name, forecastLayer.visible);
        }
        
        this.toggleIconVisibility(forecastLayer.name, forecastLayer.visible);
      });
    }
  }

  private async loadEventLayers(): Promise<void> {
    const eventData: AlertApiResponse = await this.weatherLayersService.fetchEventData();

    this.weatherLayersService.addEventsToSource(eventData);
    this.createEventLayer(eventData);
  }

  private createEventLayer(eventData: AlertApiResponse): void {
    const events = this.weatherLayersService.getEventLayers();
    const dataFeatures = eventData.features;
    events.forEach(evt => {
      const filteredFeatures = dataFeatures.filter(dataFeature => { return evt.name === dataFeature.properties.event; });
      const newFeatureData = { ...eventData, features: filteredFeatures };
      this.addEventLayer(newFeatureData, evt.name);
    });

  }

  private addEventLayer(eventData: AlertApiResponse, eventType: string): void {
    const geoJSONFormat = new GeoJSON();
    const features = geoJSONFormat.readFeatures(eventData, { featureProjection: projection });
    const vectorSource = new VectorSource({
      features: features
    });

    const vectorLayer = new VectorLayer({
      source: vectorSource,
      visible: true,
      style: (feature) => this.styleEvent(feature)
    });

    this.map.addLayer(vectorLayer);
    this.eventVectorLayerMap.set(eventType, vectorLayer);
    this.eventVisibilityState.set(eventType, true);
  }

  private async toggleEventLayers(eventLayers: EventLayer[]): Promise<void> {
    if (this.map) {
      eventLayers.forEach(eventLayer => {
        const vectorLayer = this.eventVectorLayerMap.get(eventLayer.name);

        if (vectorLayer) {
          vectorLayer.setVisible(eventLayer.visible);
          this.eventVisibilityState.set(eventLayer.name, eventLayer.visible);
        }
      });
    }
  }

  private styleEvent(feature: FeatureLike): Style {
    const properties = feature.getProperties();
    const severity = properties['severity'];
    const color = severity ? EventSeverityScale[severity.toUpperCase() as keyof typeof EventSeverityScale] : '0, 100, 255';
    const style = new Style({
      fill: new Fill({
        color: `rgba(${color}, 0.2)`
      }),
      stroke: new Stroke({
        color: `rgba(${color}, 1)`,
        width: 2
      })
    });

    return style;
  }

  private formatTime(dateTimeString: string): string {
    const dateTime = new Date(dateTimeString);
    const timeString = dateTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
      timeZoneName: 'short'
    });
    const dateString = dateTime.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit'
    });

    return `${dateString} at ${timeString}`;
  }
  private buildEventContent(props: any): string {
    let content = '';
    const {
      // areaDesc,
      // certainty,
      description,
      // effective,
      // ends,
      event,
      expires,
      headline,
      // status,
      // urgency,
      // instruction,
      // onset
      severity
    } = props;

    content = `<p><b>${headline}</b></p>
               <p>Event: ${event}</p> 
               <p>Severity: ${severity}</p>
               <p>Expires: ${this.formatTime(expires)}</p>
               <p>${description}</p>`;
    return content;
  }

  private getInfoPanelFeature(layerName: string) : any {
    const features = this.forecastVectorLayerMap.get(layerName)?.getSource()?.getFeatures();
    return features;
  }

  private highlightEventLayer(features: FeatureLike): void {
    const featureId = features.getId();

    this.eventVectorLayerMap.forEach((vectorLayer, key) => {
      const layerFeatures = vectorLayer.getSource()?.getFeatures();
      const vectorStyle = vectorLayer.getStyle();
      const featureOutlineStyle = new Style({
        zIndex: 1,
        stroke: new Stroke({
          color:'black',
          width: 7
        })
      });

      if (layerFeatures){
        layerFeatures.forEach(layerFeature => {
          if (layerFeature.getId() === featureId) {
            let highlightStyle;
            if (typeof vectorStyle === 'function') {
              const originalStyle = vectorStyle(layerFeature, 0) as Style;
              highlightStyle = new Style({
                zIndex: 10,
                fill: new Fill({
                  color: originalStyle.getFill()?.getColor()
                }),
                stroke: new Stroke({
                  color: originalStyle.getStroke()?.getColor(),
                  width: 5
                })
              });
            }

            layerFeature.setStyle([featureOutlineStyle, highlightStyle]);
          } else {
            const defaultStyle = this.styleEvent(layerFeature);
            layerFeature.setStyle(defaultStyle);
          }
          
        });
      }
    });
  }

  private showInfoPanel(feature: any): void {
    const props = feature.getProperties();

    if (props && props['@type'] === 'wx:Alert') {
      const content = this.buildEventContent(props);
      this.infoPanelService.setInfoPanelType(InfoType.EVENT);
      this.infoPanelService.setInfoPanelData(content);
    } else if (props && props.periods) {
      this.infoPanelService.setInfoPanelType(InfoType.FORECAST);
      this.infoPanelService.setInfoPanelData(props);
    }
   
    this.infoPanelService.setInfoPanelVisibility(true);
  }

  private toggleRadarLayers(radarLayers: EventLayer[]): void {
    if (this.map) {
      radarLayers.forEach(radarLayer => {
        const tileLayer = this.radarTileLayerMap.get(radarLayer.name);

        if(tileLayer){
          tileLayer.setVisible(radarLayer.visible)
          this.radarVisibilityState.set(radarLayer.name, radarLayer.visible);
        }
      });
    }
  }

  private async addRVRadarLayer(): Promise<void> {
    const rvAPIData: RainViewerApiData = await this.weatherLayersService.fetchRainViewerAPI();
    const nowcast = rvAPIData.radar.nowcast[0];
    const url = `/rvTileCache${nowcast.path}/256/{z}/{x}/{y}/1/0_0.png`

    const source = new XYZ({
      url: url,
      tileSize: 256,
    });

    const radarLayer = new TileLayer({
      source: source,
      opacity: 0.6,
      visible: false
    });

    this.weatherLayersService.addRadarsToSource(RadarLayerNames.RV);
    this.map.addLayer(radarLayer);
    this.radarTileLayerMap.set(RadarLayerNames.RV, radarLayer);
    this.eventVisibilityState.set(RadarLayerNames.RV, false);
  }

  private addNOAARadarLayer(): void {
    const radarSource = new TileWMS({
      url: '/noaa',
      params: {
        'LAYERS': 'conus_bref_qcd',
        'TILED': true,
        'FORMAT': 'image/png',
        'STYLES': 'radar_reflectivity', // Add the style parameter
        'SRS': projection, // Specify the SRS
        'TRANSPARENT': true // Make the layer transparent
      },
      serverType: 'geoserver' // Specify the server type if needed
    });

    const radarLayer = new TileLayer({
      source: radarSource,
      opacity: 0.6
    });

    this.weatherLayersService.addRadarsToSource(RadarLayerNames.NOAA);
    this.map.addLayer(radarLayer);
    this.radarTileLayerMap.set(RadarLayerNames.NOAA, radarLayer);
    this.eventVisibilityState.set(RadarLayerNames.NOAA, true);
  }

  delayResolve(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  @HostListener('window:resize', ['$event'])
  onWindowResize(): void {
    if (this.map) {
      this.map.updateSize();
    }
  }
}
