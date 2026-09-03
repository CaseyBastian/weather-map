import {
	Component,
	AfterViewInit,
	HostListener,
	OnDestroy,
	Renderer2,
	ViewChild,
	ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Subject, takeUntil } from 'rxjs';

import * as d3 from 'd3';
import { geoMercator, geoPath } from 'd3-geo';

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
	RainViewerApiData,
} from '../services/weather-layers.service';
import { InfoPanelService, InfoType } from '../services/info-panel.service';
import { Geometry, Polygon, Circle as CircleGeom } from 'ol/geom';
import { Extent } from 'ol/extent';
import { GeoPathLocation, GeoPathService } from '../services/geo-path.service';
import { Coordinate } from 'ol/coordinate';
import LayerGroup from 'ol/layer/Group';
import { environment } from '../../environments/environment';

enum EventSeverityColorScale {
	MINOR = '143, 193, 122',
	MODERATE = '229, 184, 92',
	SEVERE = '201, 106, 45',
	EXTREME = '216, 138, 125',
	UNKNOWN = '143, 179, 193',
}

enum EventSeverityZIndex {
	EXTREME = 4,
	SEVERE = 3,
	MODERATE = 2,
	MINOR = 1,
	UNKNOWN = 0,
}

const EventSeverityAppearance: Record<
	keyof typeof EventSeverityZIndex,
	{ fillOpacity: number; strokeWidth: number; lineDash?: number[] }
> = {
	UNKNOWN: { fillOpacity: 0.045, strokeWidth: 1, lineDash: [5, 4] },
	MINOR: { fillOpacity: 0.06, strokeWidth: 1.2, lineDash: [3, 3] },
	MODERATE: { fillOpacity: 0.09, strokeWidth: 1.4 },
	SEVERE: { fillOpacity: 0.125, strokeWidth: 1.8 },
	EXTREME: { fillOpacity: 0.17, strokeWidth: 2.2 },
};

const MapLayerZIndex = {
	BASE: 0,
	FORECAST: 10,
	RADAR: 20,
	ALERTS: 30,
	MARKERS: 40,
} as const;

interface NewProperties {
	locationName: string;
	hourlyForecast: any;
	center: null | number[];
	impacted: boolean;
	impactingEvents: any[];
}

const projection = 'EPSG:3857';

@Component({
	selector: 'app-weather-map',
	standalone: true,
	templateUrl: './weather-map.component.html',
	styleUrl: './weather-map.component.scss',
	imports: [CommonModule, MatIconModule],
})
export class WeatherMapComponent implements AfterViewInit, OnDestroy {
	@ViewChild('mapElement', { static: true })
	mapElement!: ElementRef<HTMLElement>;
	@ViewChild('svgOverlayElement', { static: true })
	svgOverlay!: ElementRef<SVGElement>;

	private destroy$ = new Subject<void>();

	private map!: OLMap;
	private USCenterLongLat: number[] = [-98.5795, 39.8283];
	private iconOverlayMap: Map<string, Overlay> = new Map();
	private markerOverlayMap: Map<string, Overlay> = new Map();
	private forecastVectorLayerMap: Map<string, VectorLayer> = new Map();
	private eventVectorLayer?: VectorLayer;
	private eventVisibilityState: Map<string, boolean> = new Map();
	private forecastVisibilityState: Map<string, boolean> = new Map();
	private radarVisibilityState: Map<string, boolean> = new Map();
	private radarTileLayerMap: Map<string, TileLayer> = new Map();
	private impactedLocations: Map<string, Feature> = new Map();
	private markerOverlayDict = new Map<string, Overlay>();
	private allLocationsSource: VectorSource = new VectorSource();

	private markerVectorLayers: LayerGroup = new LayerGroup({ layers: [] });
	private lastLocation: GeoPathLocation | undefined;
	private hoveredFeature: FeatureLike | null = null;
	private selectedFeature: FeatureLike | null = null;
	private pointerMoveFrame: number | null = null;
	private eventStyleCache = new Map<string, Style>();
	private eventInteractionStyleCache = new Map<string, Style[]>();
	private radarAnimationInterval: ReturnType<typeof setInterval> | null = null;
	private radarInteractionResumeTimer: ReturnType<typeof setTimeout> | null = null;
	private radarTilesLoading = 0;
	private radarInteractionPending = false;
	private resumeRadarAfterInteraction = false;
	private radarInteractionDeadline = 0;
	private dataRefreshInterval: ReturnType<typeof setInterval> | null = null;
	private refreshInFlight = false;
	private lastAlertRefreshAt = 0;
	private lastRadarRefreshAt = 0;
	private lastForecastRefreshAt = 0;
	private readonly alertRefreshMs = 90_000;
	private readonly radarRefreshMs = 5 * 60_000;
	private readonly forecastRefreshMs = 30 * 60_000;
	private radarPastFrameCount = 0;

	radarFrames: Array<{ time: number; path: string }> = [];
	currentRadarFrameIndex = 0;
	radarAnimationPlaying = false;
	radarAnimationAvailable = false;
	radarViewUpdating = false;

	constructor(
		private element: ElementRef<HTMLElement>,
		private geoPathService: GeoPathService,
		private weatherLayersService: WeatherLayersService,
		private infoPanelService: InfoPanelService,
		private renderer: Renderer2
	) {}

	ngAfterViewInit(): void {
		this.initializeMap();

		void this.loadLayers();

		this.weatherLayersService.eventLayers$
			.pipe(takeUntil(this.destroy$))
			.subscribe((eventLayers) => {
				this.toggleEventLayers(eventLayers);
			});
		this.weatherLayersService.forecastLayers$
			.pipe(takeUntil(this.destroy$))
			.subscribe((forecastLayers) => {
				this.toggleForecastLayers(forecastLayers);
			});
		this.weatherLayersService.radarLayers$
			.pipe(takeUntil(this.destroy$))
			.subscribe((radarLayers) => {
				this.toggleRadarLayers(radarLayers);
			});
		this.infoPanelService.infoPanelVisible$
			.pipe(takeUntil(this.destroy$))
			.subscribe((visible) => {
				if (!visible && this.selectedFeature) {
					this.selectedFeature = null;
					this.eventVectorLayer?.changed();
				}
			});
		this.weatherLayersService.refreshRequests$
			.pipe(takeUntil(this.destroy$))
			.subscribe(() => void this.refreshWeatherData(true));
	}

	ngOnDestroy(): void {
		if (this.pointerMoveFrame !== null) {
			cancelAnimationFrame(this.pointerMoveFrame);
		}
		this.stopRadarAnimation();
		this.cancelRadarInteractionResume();
		if (this.dataRefreshInterval) {
			clearInterval(this.dataRefreshInterval);
			this.dataRefreshInterval = null;
		}

		this.destroy$.next();
		this.destroy$.complete();
	}

	private initializeMap(): void {
		const mapElement = this.mapElement.nativeElement;

		const osmLayer = new TileLayer({
			className: 'basemap-layer',
			preload: 2,
			source: new OSM(),
		});
		osmLayer.on('prerender', (event) => {
			const context = event.context;
			if (!(context instanceof CanvasRenderingContext2D)) return;

			context.save();
			context.filter =
				'invert(0.9) hue-rotate(180deg) brightness(0.62) contrast(1.18) saturate(0.38) sepia(0.12)';
		});
		osmLayer.on('postrender', (event) => {
			const context = event.context;
			if (!(context instanceof CanvasRenderingContext2D)) return;

			context.restore();
			context.save();
			context.globalCompositeOperation = 'source-atop';
			context.fillStyle = 'rgba(196, 132, 20, 0.055)';
			context.fillRect(0, 0, context.canvas.width, context.canvas.height);
			context.restore();
		});
		osmLayer.setZIndex(MapLayerZIndex.BASE);
		this.markerVectorLayers.setZIndex(MapLayerZIndex.MARKERS);

		this.map = new OLMap({
			target: mapElement,
			layers: [osmLayer, this.markerVectorLayers],
			view: new View({
				center: fromLonLat(this.USCenterLongLat),
				zoom: 5,
			}),
		});

		this.map.on('movestart', () => {
			this.prepareRadarForMapInteraction();
			const svgElement = this.svgOverlay.nativeElement;
			const svg = d3.select(svgElement);

			svg.selectAll('path').style('visibility', 'hidden');
		});
		this.map.on('moveend', () => {
			const svgElement = this.svgOverlay.nativeElement;
			const svg = d3.select(svgElement);

			svg.selectAll('path').style('visibility', 'visible');
			this.updatePaths();
			this.prioritizeRadarForCurrentView();
		});

		this.map.on('pointermove', (evt) => {
			if (evt.dragging || this.pointerMoveFrame !== null) return;

			this.pointerMoveFrame = requestAnimationFrame(() => {
				this.pointerMoveFrame = null;
				const feature = this.map.forEachFeatureAtPixel(
					evt.pixel,
					(feat) => feat,
					{ hitTolerance: 5 }
				);
				const interactive = !!feature;
				this.map.getTargetElement().style.cursor = interactive
					? 'pointer'
					: '';

				const isAlert = feature?.get('@type') === 'wx:Alert';
				const nextHovered = isAlert ? feature! : null;
				if (nextHovered !== this.hoveredFeature) {
					this.hoveredFeature = nextHovered;
					this.eventVectorLayer?.changed();
				}
			});
		});
		this.map.getViewport().addEventListener('pointerleave', () => {
			this.map.getTargetElement().style.cursor = '';
			if (this.hoveredFeature) {
				this.hoveredFeature = null;
				this.eventVectorLayer?.changed();
			}
		});

		this.map.on('click', (evt) => {
			const feature = this.map.forEachFeatureAtPixel(
				evt.pixel,
				(feat) => feat
			);
			if (!feature) {
				this.infoPanelService.setInfoPanelVisibility(false);
				this.hoveredFeature = null;
				this.selectedFeature = null;
				this.eventVectorLayer?.changed();
				this.clearPaths();
			}

			if (feature) {
				const properties = feature.getProperties();
				const { type, location } = properties;

				if (type && type === 'marked-location') {
					this.selectedFeature = null;
					this.handleMarkerClick(location);
				} else {
					this.selectedFeature =
						feature.get('@type') === 'wx:Alert' ? feature : null;
					this.eventVectorLayer?.changed();
					this.showInfoPanel(feature);
				}
			}
		});
	}

	private addLocationMarkers() {
		const locations = this.geoPathService.locations;

		locations.forEach((loc) => this.createMarkerOverlay(loc));
	}

	private addForecastLayer(
		layerName: string,
		features: Feature[],
		hourlyForecast: any,
		visible: boolean = true
	): void {
		let vectorLayer = this.forecastVectorLayerMap.get(layerName);
		if (vectorLayer) {
			vectorLayer
				.getSource()
				?.getFeatures()
				.forEach((feature) => this.allLocationsSource.removeFeature(feature));
		}

		const vectorSource = new VectorSource({
			features: features.map((feature) => {
				const extent = feature.getGeometry()?.getExtent();
				const newProperties: NewProperties = {
					locationName: layerName,
					hourlyForecast: hourlyForecast,
					center: <null | number[]>null,
					impacted: false,
					impactingEvents: <any[]>[],
				};

				if (extent) {
					const centerX = (extent[0] + extent[2]) / 2;
					const centerY = (extent[1] + extent[3]) / 2;
					const center: [number, number] = [centerX, centerY];

					newProperties.center = center;
				}

				feature.setProperties({
					...feature.getProperties(),
					...newProperties,
				});

				this.allLocationsSource.addFeature(feature);

				return feature;
			}),
		});

		if (vectorLayer) {
			vectorLayer.setSource(vectorSource);
			vectorLayer.setVisible(visible);
		} else {
			vectorLayer = new VectorLayer({
				source: vectorSource,
				visible: visible,
			});
			vectorLayer.setZIndex(MapLayerZIndex.FORECAST);

			this.map.addLayer(vectorLayer);
			this.forecastVectorLayerMap.set(layerName, vectorLayer);
		}

		this.forecastVisibilityState.set(layerName, visible);

		const extent = vectorSource.getExtent();
		const center = [
			(extent[0] + extent[2]) / 2,
			(extent[1] + extent[3]) / 2,
		];

		this.createIconOverlay(layerName, center, visible);
	}

	private createIconOverlay(
		layerName: string,
		center: number[],
		visible: boolean
	) {
		let iconOverlay = this.iconOverlayMap.get(layerName);

		if (iconOverlay) {
			const iconElement = iconOverlay.getElement();

			if (iconElement) {
				iconElement.style.display = visible ? 'block' : 'none';
			}
			iconOverlay.setPosition(center);
		} else {
			const iconElement = this.renderer.createElement('div');

			this.renderer.setStyle(iconElement, 'position', 'absolute');
			this.renderer.setStyle(
				iconElement,
				'transform',
				'translate(-30%, -50%)'
			);

			const placeIcon = this.renderer.createElement('mat-icon');

			this.renderer.setStyle(
				placeIcon,
				'color',
				layerName === 'Ft. Belvoir' ? '#866fa0' : '#c48414'
			);
			this.renderer.setStyle(placeIcon, 'fontSize', '18px');
			this.renderer.appendChild(
				placeIcon,
				this.renderer.createText('place')
			);
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
				positioning: 'bottom-center',
			});

			newIconOverlay.setPosition(center);
			this.map.addOverlay(newIconOverlay);
			this.iconOverlayMap.set(layerName, newIconOverlay);
		}

		this.toggleIconVisibility(layerName, visible);
	}

	private async loadForecastLayers(): Promise<void> {
		const forecastLayers = this.weatherLayersService.getForecastLayers();
		const batchSize = 4;

		for (let i = 0; i < forecastLayers.length; i += batchSize) {
			const layerBatch = forecastLayers.slice(i, i + batchSize);

			await Promise.allSettled(
				layerBatch.map(async (visibleLayer) => {
					const geoJSONFormat = new GeoJSON();

					const gridPoint =
						await this.weatherLayersService.getGridPoint(
							visibleLayer.latitude,
							visibleLayer.longitude
						);
					if (!gridPoint) {
						return;
					}
					const [forecastData, hourlyForecast] = await Promise.all([
						this.weatherLayersService.fetchForecastData(gridPoint),
						this.weatherLayersService.fetchHourlyForecastData(
							gridPoint
						),
					]);
					if (!forecastData) {
						return;
					}

					const features = geoJSONFormat.readFeatures(forecastData, {
						featureProjection: projection,
					});
					const periods =
						hourlyForecast?.properties?.periods?.slice(0, 6) || [];

					this.addForecastLayer(
						visibleLayer.name,
						features,
						periods,
						visibleLayer.visible
					);
				})
			);
		}

		this.recalculateImpactedLocations();
	}

	private toggleIconVisibility(layerName: string, visible: boolean): void {
		const iconOverlay = this.iconOverlayMap.get(layerName);
		if (iconOverlay) {
			const iconElement = iconOverlay.getElement();
			if (iconElement) {
				iconElement.style.display = visible ? 'block' : 'none';
			}
		}
	}

	private async toggleForecastLayers(
		forecastLayers: ForecastLayer[]
	): Promise<void> {
		if (this.map) {
			forecastLayers.forEach((forecastLayer) => {
				const vectorLayer = this.forecastVectorLayerMap.get(
					forecastLayer.name
				);

				if (vectorLayer) {
					vectorLayer.setVisible(forecastLayer.visible);
					this.forecastVisibilityState.set(
						forecastLayer.name,
						forecastLayer.visible
					);
				}

				this.toggleIconVisibility(
					forecastLayer.name,
					forecastLayer.visible
				);
			});
		}
	}

	private async loadEventLayers(): Promise<void> {
		const eventData: AlertApiResponse =
			await this.weatherLayersService.fetchEventData();

		this.weatherLayersService.addEventsToSource(eventData);
		this.createOrUpdateEventLayer(eventData);
	}

	private createOrUpdateEventLayer(eventData: AlertApiResponse): void {
		const events = this.weatherLayersService.getEventLayers();
		events.forEach((event) =>
			this.eventVisibilityState.set(event.name, event.visible)
		);
		const geoJSONFormat = new GeoJSON();
		const features = geoJSONFormat.readFeatures(eventData, {
			featureProjection: projection,
		});

		this.resetImpactedLocations();
		features.forEach((feature) => this.findImpactedLocations(feature));

		if (this.eventVectorLayer) {
			const selectedAlertId = this.selectedFeature?.get('id');
			this.hoveredFeature = null;
			const source = this.eventVectorLayer.getSource();
			source?.clear(true);
			source?.addFeatures(features);
			if (selectedAlertId) {
				const refreshedSelection =
					features.find((feature) => feature.get('id') === selectedAlertId) ?? null;
				this.selectedFeature = refreshedSelection;
				if (refreshedSelection) {
					this.infoPanelService.setInfoPanelData(
						refreshedSelection.getProperties()
					);
				} else {
					this.infoPanelService.setInfoPanelVisibility(false);
				}
			}
			this.eventVectorLayer.changed();
		} else {
			const vectorSource = new VectorSource({ features });
			this.eventVectorLayer = new VectorLayer({
				source: vectorSource,
				visible: true,
				style: (feature) => this.getEventStyle(feature),
			});
			this.eventVectorLayer.setZIndex(MapLayerZIndex.ALERTS);
			this.map.addLayer(this.eventVectorLayer);
		}
	}

	private resetImpactedLocations(): void {
		this.impactedLocations.clear();
		this.allLocationsSource.getFeatures().forEach((location) => {
			location.setProperties({
				...location.getProperties(),
				impacted: false,
				impactingEvents: [],
			});
		});
	}

	private recalculateImpactedLocations(): void {
		this.resetImpactedLocations();
		this.eventVectorLayer
			?.getSource()
			?.getFeatures()
			.forEach((feature) => this.findImpactedLocations(feature));
	}

	private findImpactedLocations(feature: Feature<Geometry>) {
		const geometry = feature.getGeometry();
		const locations = this.allLocationsSource.getFeatures();
		const properties = feature.getProperties();

		locations.forEach((location) => {
			const center = location.get('center');

			if (center && geometry?.intersectsCoordinate(center)) {
				const locProperties =
					location.getProperties() as NewProperties & {
						[key: string]: any;
					};
				const { impactingEvents: newImpactEvents, locationName } =
					locProperties;

				newImpactEvents.push(properties);

				location.setProperties({
					...locProperties,
					impacted: true,
					impactingEvents: newImpactEvents,
				});

				this.impactedLocations.set(locationName, location);
			}
		});
	}

	private async toggleEventLayers(eventLayers: EventLayer[]): Promise<void> {
		if (this.map) {
			eventLayers.forEach((eventLayer) => {
				this.eventVisibilityState.set(
					eventLayer.name,
					eventLayer.visible
				);
			});
			this.eventVectorLayer?.changed();
		}
	}

	private getEventStyle(feature: FeatureLike): Style | Style[] | undefined {
		const eventType = feature.get('event');
		if (this.eventVisibilityState.get(eventType) === false) return undefined;

		const style = this.styleEvent(feature);
		if (feature === this.selectedFeature) {
			return this.interactionEventStyle(feature, 'selected');
		}
		if (feature === this.hoveredFeature) {
			return this.interactionEventStyle(feature, 'hovered');
		}
		return style;
	}

	private styleEvent(feature: FeatureLike): Style {
		const severity = this.eventSeverity(feature);
		const cached = this.eventStyleCache.get(severity);
		if (cached) return cached;

		const color = EventSeverityColorScale[severity];
		const appearance = EventSeverityAppearance[severity];
		const style = new Style({
			zIndex: EventSeverityZIndex[severity],
			fill: new Fill({
				color: `rgba(${color}, ${appearance.fillOpacity})`,
			}),
			stroke: new Stroke({
				color: `rgba(${color}, 0.88)`,
				width: appearance.strokeWidth,
				lineDash: appearance.lineDash,
			}),
		});
		this.eventStyleCache.set(severity, style);
		return style;
	}

	private eventSeverity(
		feature: FeatureLike
	): keyof typeof EventSeverityZIndex {
		const rawSeverity = String(feature.get('severity') ?? '')
			.trim()
			.toUpperCase();
		return Object.prototype.hasOwnProperty.call(
			EventSeverityZIndex,
			rawSeverity
		)
			? (rawSeverity as keyof typeof EventSeverityZIndex)
			: 'UNKNOWN';
	}

	private interactionEventStyle(
		feature: FeatureLike,
		state: 'hovered' | 'selected'
	): Style[] {
		const severity = this.eventSeverity(feature);
		const key = `${severity}:${state}`;
		const cached = this.eventInteractionStyleCache.get(key);
		if (cached) return cached;

		const color = EventSeverityColorScale[severity];
		const selected = state === 'selected';
		const styles = [
			new Style({
				zIndex: 99,
				stroke: new Stroke({
					color: selected ? '#c48414' : '#0e0f11',
					width: selected ? 6 : 4,
				}),
			}),
			new Style({
				zIndex: 100,
				fill: new Fill({ color: `rgba(${color}, ${selected ? 0.24 : 0.16})` }),
				stroke: new Stroke({
					color: `rgba(${color}, 1)`,
					width: selected ? 2.8 : 2.2,
				}),
			}),
		];
		this.eventInteractionStyleCache.set(key, styles);
		return styles;
	}

	private formatTime(dateTimeString: string): string {
		const dateTime = new Date(dateTimeString);
		const timeString = dateTime.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: 'numeric',
			hour12: true,
			timeZoneName: 'short',
		});
		const dateString = dateTime.toLocaleDateString('en-US', {
			month: 'short',
			day: '2-digit',
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
			severity,
		} = props;

		content = `<p><b>${headline}</b></p>
               <p>Event: ${event}</p>
               <p>Severity: ${severity}</p>
               <p>Expires: ${this.formatTime(expires)}</p>
               <p>${description}</p>`;
		return content;
	}

	private getInfoPanelFeature(layerName: string): any {
		const features = this.forecastVectorLayerMap
			.get(layerName)
			?.getSource()
			?.getFeatures();
		return features;
	}

	private showInfoPanel(feature: any): void {
		const props = feature.getProperties();

		if (props && props['@type'] === 'wx:Alert') {
			this.infoPanelService.setInfoPanelType(InfoType.EVENT);
			this.infoPanelService.setInfoPanelData(props);
		} else if (props && props.periods) {
			this.infoPanelService.setInfoPanelType(InfoType.FORECAST);
			this.infoPanelService.setInfoPanelData(props);
		}

		this.infoPanelService.setInfoPanelVisibility(true);
	}

	private toggleRadarLayers(radarLayers: EventLayer[]): void {
		if (this.map) {
			radarLayers.forEach((radarLayer) => {
				const tileLayer = this.radarTileLayerMap.get(radarLayer.name);

				if (tileLayer) {
					tileLayer.setVisible(radarLayer.visible);
					this.radarVisibilityState.set(
						radarLayer.name,
						radarLayer.visible
					);
				}
			});

			const rainViewerVisible =
				radarLayers.find((layer) => layer.name === RadarLayerNames.RV)
					?.visible ?? false;
			if (rainViewerVisible && this.radarAnimationAvailable) {
				this.startRadarAnimation();
			} else {
				this.cancelRadarInteractionResume();
				this.stopRadarAnimation();
			}
		}
	}

	get currentRadarFrameLabel(): string {
		const frame = this.radarFrames[this.currentRadarFrameIndex];
		if (!frame) return 'Loading frames';
		return new Date(frame.time * 1000).toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
		});
	}

	get currentRadarFrameKind(): string {
		return this.currentRadarFrameIndex >= this.radarPastFrameCount
			? 'Forecast'
			: 'Observed';
	}

	get rainViewerVisible(): boolean {
		return this.radarVisibilityState.get(RadarLayerNames.RV) === true;
	}

	toggleRadarAnimation(): void {
		this.cancelRadarInteractionResume();
		if (this.radarAnimationPlaying) {
			this.stopRadarAnimation();
		} else {
			this.startRadarAnimation();
		}
	}

	stepRadarFrame(direction: number): void {
		this.cancelRadarInteractionResume();
		this.stopRadarAnimation();
		this.setRadarFrame(this.currentRadarFrameIndex + direction);
	}

	selectRadarFrame(index: number): void {
		this.cancelRadarInteractionResume();
		this.stopRadarAnimation();
		this.setRadarFrame(index);
	}

	private startRadarAnimation(): void {
		if (this.radarFrames.length < 2 || this.radarAnimationInterval) return;
		this.radarAnimationPlaying = true;
		this.radarAnimationInterval = setInterval(() => {
			this.setRadarFrame(this.currentRadarFrameIndex + 1);
		}, 650);
	}

	private stopRadarAnimation(): void {
		if (this.radarAnimationInterval) {
			clearInterval(this.radarAnimationInterval);
			this.radarAnimationInterval = null;
		}
		this.radarAnimationPlaying = false;
	}

	private prepareRadarForMapInteraction(): void {
		if (!this.rainViewerVisible) return;

		this.radarViewUpdating = true;
		this.radarInteractionPending = true;
		this.resumeRadarAfterInteraction = this.radarAnimationPlaying;
		this.radarInteractionDeadline = Date.now() + 1_200;
		if (this.radarAnimationPlaying) this.stopRadarAnimation();
		if (this.radarInteractionResumeTimer) {
			clearTimeout(this.radarInteractionResumeTimer);
			this.radarInteractionResumeTimer = null;
		}
	}

	private prioritizeRadarForCurrentView(): void {
		if (!this.radarInteractionPending || !this.rainViewerVisible) return;
		this.map.renderSync();
		this.scheduleRadarInteractionCompletion();
	}

	private scheduleRadarInteractionCompletion(delay = 90): void {
		if (this.radarInteractionResumeTimer) {
			clearTimeout(this.radarInteractionResumeTimer);
		}
		this.radarInteractionResumeTimer = setTimeout(() => {
			this.radarInteractionResumeTimer = null;
			if (
				this.radarTilesLoading > 0 &&
				Date.now() < this.radarInteractionDeadline
			) {
				this.scheduleRadarInteractionCompletion(80);
				return;
			}

			const shouldResume =
				this.resumeRadarAfterInteraction && this.rainViewerVisible;
			this.radarInteractionPending = false;
			this.resumeRadarAfterInteraction = false;
			this.radarViewUpdating = false;
			if (shouldResume) this.startRadarAnimation();
		}, delay);
	}

	private cancelRadarInteractionResume(): void {
		if (this.radarInteractionResumeTimer) {
			clearTimeout(this.radarInteractionResumeTimer);
			this.radarInteractionResumeTimer = null;
		}
		this.radarInteractionPending = false;
		this.resumeRadarAfterInteraction = false;
		this.radarViewUpdating = false;
	}

	private trackRadarTileLoading(source: XYZ): void {
		source.on('tileloadstart', () => {
			this.radarTilesLoading++;
		});
		const settleTile = () => {
			this.radarTilesLoading = Math.max(0, this.radarTilesLoading - 1);
			if (this.radarInteractionPending && this.radarTilesLoading === 0) {
				this.scheduleRadarInteractionCompletion(60);
			}
		};
		source.on('tileloadend', settleTile);
		source.on('tileloaderror', settleTile);
	}

	private setRadarFrame(index: number): void {
		if (!this.radarFrames.length) return;
		const normalizedIndex =
			(index + this.radarFrames.length) % this.radarFrames.length;
		const frame = this.radarFrames[normalizedIndex];
		const rainViewerLayer = this.radarTileLayerMap.get(RadarLayerNames.RV);
		const source = rainViewerLayer?.getSource();

		if (source instanceof XYZ) {
			source.setUrl(
				`${environment.rvTileCacheUrl}${frame.path}/256/{z}/{x}/{y}/1/0_0.png`
			);
			this.currentRadarFrameIndex = normalizedIndex;
		}
	}

	private async addRVRadarLayer(): Promise<void> {
		await this.refreshRainViewerFrames();
		if (!this.radarFrames.length) return;

		const firstFrame = this.radarFrames[this.currentRadarFrameIndex];
		const url = `${environment.rvTileCacheUrl}${firstFrame.path}/256/{z}/{x}/{y}/1/0_0.png`;

		const source = new XYZ({
			url: url,
			tileSize: 256,
			transition: 80,
		});
		this.trackRadarTileLoading(source);

		const radarLayer = new TileLayer({
			source: source,
			opacity: 0.6,
			visible: true,
			preload: 2,
			cacheSize: 1024,
		});
		radarLayer.setZIndex(MapLayerZIndex.RADAR);

		this.map.addLayer(radarLayer);
		this.radarTileLayerMap.set(RadarLayerNames.RV, radarLayer);
		this.radarVisibilityState.set(RadarLayerNames.RV, true);
		this.weatherLayersService.addRadarsToSource(RadarLayerNames.RV, true);
		this.startRadarAnimation();
	}

	private async refreshRainViewerFrames(): Promise<void> {
		const previousFramePath =
			this.radarFrames[this.currentRadarFrameIndex]?.path;
		const rvAPIData: RainViewerApiData =
			await this.weatherLayersService.fetchRainViewerAPI();
		const pastFrames = rvAPIData.radar.past.slice(-8);
		const nowcastFrames = rvAPIData.radar.nowcast.slice(0, 3);
		const nextFrames = [...pastFrames, ...nowcastFrames];
		if (!nextFrames.length) return;

		this.radarFrames = nextFrames;
		this.radarPastFrameCount = pastFrames.length;
		this.radarAnimationAvailable = this.radarFrames.length > 1;
		const preservedIndex = previousFramePath
			? this.radarFrames.findIndex((frame) => frame.path === previousFramePath)
			: -1;
		this.currentRadarFrameIndex =
			preservedIndex >= 0 ? preservedIndex : Math.max(0, pastFrames.length - 1);

		const existingLayer = this.radarTileLayerMap.get(RadarLayerNames.RV);
		const existingSource = existingLayer?.getSource();
		if (existingSource instanceof XYZ) {
			this.setRadarFrame(this.currentRadarFrameIndex);
		}
	}

	private addNOAARadarLayer(): void {
		const url = `${environment.noaaApiUrl}`;
		const radarSource = new TileWMS({
			url,
			params: {
				LAYERS: 'conus_bref_qcd',
				TILED: true,
				FORMAT: 'image/png',
				STYLES: 'radar_reflectivity', // Add the style parameter
				SRS: projection, // Specify the SRS
				TRANSPARENT: true, // Make the layer transparent
			},
			serverType: 'geoserver', // Specify the server type if needed
		});

		const radarLayer = new TileLayer({
			source: radarSource,
			opacity: 0.6,
			visible: false,
		});

		radarLayer.setZIndex(MapLayerZIndex.RADAR);
		this.map.addLayer(radarLayer);
		this.radarTileLayerMap.set(RadarLayerNames.NOAA, radarLayer);
		this.radarVisibilityState.set(RadarLayerNames.NOAA, false);
		this.weatherLayersService.addRadarsToSource(RadarLayerNames.NOAA, false);
	}

	private createMarkerOverlay(location: GeoPathLocation): void {
		const { locationName, longitude, latitude } = location;
		const center = fromLonLat([longitude, latitude]);
		let overlay = this.markerOverlayMap.get(locationName);

		if (!overlay) {
			const iconElement = this.renderer.createElement('button');
			this.renderer.addClass(iconElement, 'marker-icon-wrapper');
			this.renderer.setAttribute(iconElement, 'type', 'button');
			this.renderer.setAttribute(
				iconElement,
				'aria-label',
				`Show routes from ${locationName}`
			);
			this.renderer.setStyle(iconElement, 'position', 'absolute');
			this.renderer.setStyle(
				iconElement,
				'transform',
				'translate(-50%, -100%)'
			);

			const icon = this.renderer.createElement('mat-icon');
			this.renderer.setStyle(icon, 'color', '#3cb8c9');
			this.renderer.setStyle(icon, 'fontSize', '24px');
			this.renderer.addClass(icon, 'mat-icon');
			this.renderer.addClass(icon, 'material-icons');
			this.renderer.addClass(icon, 'marker-icon');
			this.renderer.appendChild(
				icon,
				this.renderer.createText('location_on')
			);

			const pulseCircle = this.renderer.createElement('div');
			this.renderer.addClass(pulseCircle, 'pulse-circle');
			this.renderer.appendChild(iconElement, pulseCircle);
			this.renderer.appendChild(iconElement, icon);
			this.renderer.listen(iconElement, 'click', () =>
				this.handleMarkerClick(location)
			);

			overlay = new Overlay({
				element: iconElement,
				positioning: 'bottom-center',
			});

			overlay.setPosition(center);
			this.markerOverlayDict.set(locationName, overlay);
			this.map.addOverlay(overlay);

			const circleGeom = new CircleGeom(center, 20000);

			const feature = new Feature({
				geometry: circleGeom,
				type: 'marked-location',
				location,
			});

			const style = new Style({
				fill: new Fill({
					color: 'rgba(0,0,0,0)',
				}),
				stroke: new Stroke({
					color: 'black',
					width: 2,
				}),
			});

			feature.set('type', 'marked-location');
			feature.setStyle(style);

			const vectorSource = new VectorSource({
				features: [feature],
			});

			const vectorLayer = new VectorLayer({
				source: vectorSource,
			});

			this.markerVectorLayers.getLayers().push(vectorLayer);
		}
	}

	private handleMarkerClick(location: GeoPathLocation) {
		this.lastLocation = location;

		const otherLocations = this.geoPathService.locations.filter(
			(loc) => location.locationName !== loc.locationName
		);

		this.drawArcs(location, otherLocations);
	}

	private drawArcs(
		selectedLocation: GeoPathLocation,
		otherLocations: GeoPathLocation[]
	) {
		const svgElement = this.svgOverlay.nativeElement;

		d3.select(svgElement).selectAll('*').remove();

		const svg = d3.select(svgElement);
		const { clientWidth: width, clientHeight: height } = svgElement;
		const view = this.map.getView();
		const center = view.getCenter();
		const zoom = view.getZoom();
		const start: [number, number] = [
			selectedLocation.longitude,
			selectedLocation.latitude,
		];
		const startPixel = this.map.getPixelFromCoordinate(
			fromLonLat(start)
		) as [number, number];

		otherLocations.forEach((location) => {
			const end: [number, number] = [
				location.longitude,
				location.latitude,
			];
			const endPixel = this.map.getPixelFromCoordinate(
				fromLonLat(end)
			) as [number, number];

			if (!startPixel || !endPixel) {
				return;
			}

			const arcHeight = 60;
			const midPointX = (startPixel[0] + endPixel[0]) / 2;
			const midPointY = Math.min(startPixel[1], endPixel[1]) - arcHeight;

			const lineData: [number, number][] = [
				[startPixel[0], startPixel[1]],
				[midPointX, midPointY],
				[endPixel[0], endPixel[1]],
			];

			const lineGenerator = d3
				.line()
				.curve(d3.curveBasis)
				.x((d) => d[0])
				.y((d) => d[1]);

			svg.append('path')
				.datum(lineData)
				.attr('class', 'curved-line')
				.attr('stroke', 'black')
				.attr('stroke-width', 2)
				.attr('fill', 'none')
				.attr('d', lineGenerator);
		});
	}

	updatePaths() {
		if (this.lastLocation) {
			const otherLocations = this.geoPathService.locations.filter(
				(loc) => this.lastLocation!.locationName !== loc.locationName
			);

			this.drawArcs(this.lastLocation, otherLocations);
		} else return;
	}

	clearPaths() {
		const svgElement = this.svgOverlay.nativeElement;

		d3.select(svgElement).selectAll('*').remove();
		this.lastLocation = undefined;
	}

	private async loadLayers(): Promise<void> {
		this.refreshInFlight = true;
		this.weatherLayersService.beginDataRefresh();
		this.addLocationMarkers();
		this.addNOAARadarLayer();

		let successfulFeeds = 0;
		let failedFeeds = 0;
		const forecastResult = await Promise.allSettled([
			this.loadForecastLayers(),
		]);
		if (forecastResult[0].status === 'fulfilled') {
			this.lastForecastRefreshAt = Date.now();
			successfulFeeds++;
		} else {
			failedFeeds++;
		}

		const liveResults = await Promise.allSettled([
			this.loadEventLayers(),
			this.addRVRadarLayer(),
		]);
		if (liveResults[0].status === 'fulfilled') {
			this.lastAlertRefreshAt = Date.now();
			successfulFeeds++;
		} else {
			failedFeeds++;
		}
		if (liveResults[1].status === 'fulfilled') {
			this.lastRadarRefreshAt = Date.now();
			successfulFeeds++;
		} else {
			failedFeeds++;
		}

		if (successfulFeeds > 0) {
			this.weatherLayersService.completeDataRefresh(failedFeeds > 0);
		} else {
			this.weatherLayersService.failDataRefresh();
		}

		this.refreshInFlight = false;
		this.startAutoRefresh();
	}

	private startAutoRefresh(): void {
		if (this.dataRefreshInterval) return;
		this.dataRefreshInterval = setInterval(
			() => void this.refreshWeatherData(),
			30_000
		);
	}

	private async refreshWeatherData(forceAll = false): Promise<void> {
		if (this.refreshInFlight) return;

		const now = Date.now();
		const refreshForecast =
			forceAll || now - this.lastForecastRefreshAt >= this.forecastRefreshMs;
		const refreshAlerts =
			forceAll || now - this.lastAlertRefreshAt >= this.alertRefreshMs;
		const refreshRadar =
			forceAll || now - this.lastRadarRefreshAt >= this.radarRefreshMs;
		if (!refreshForecast && !refreshAlerts && !refreshRadar) return;

		this.refreshInFlight = true;
		this.weatherLayersService.beginDataRefresh();
		let successfulFeeds = 0;
		let failedFeeds = 0;

		if (refreshForecast) {
			try {
				await this.loadForecastLayers();
				this.lastForecastRefreshAt = Date.now();
				successfulFeeds++;
			} catch {
				failedFeeds++;
			}
		}

		const tasks: Array<{ feed: 'alerts' | 'radar'; promise: Promise<void> }> = [];
		if (refreshAlerts) {
			tasks.push({ feed: 'alerts', promise: this.loadEventLayers() });
		}
		if (refreshRadar) {
			tasks.push({ feed: 'radar', promise: this.refreshRainViewerFrames() });
		}

		const results = await Promise.allSettled(tasks.map((task) => task.promise));
		results.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				if (tasks[index].feed === 'alerts') this.lastAlertRefreshAt = Date.now();
				if (tasks[index].feed === 'radar') this.lastRadarRefreshAt = Date.now();
				successfulFeeds++;
			} else {
				failedFeeds++;
			}
		});

		if (successfulFeeds > 0) {
			this.weatherLayersService.completeDataRefresh(failedFeeds > 0);
		} else {
			this.weatherLayersService.failDataRefresh();
		}
		this.refreshInFlight = false;
	}

	@HostListener('document:visibilitychange')
	onDocumentVisibilityChange(): void {
		if (document.visibilityState === 'visible') {
			void this.refreshWeatherData();
		}
	}

	@HostListener('window:resize', ['$event'])
	onWindowResize(): void {
		if (this.map) {
			this.map.updateSize();
		}
	}
}
