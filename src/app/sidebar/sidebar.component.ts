import { Component, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';

import {
	WeatherLayersService,
	SourceLayerType,
	EventLayer,
	ForecastLayer,
} from '../services/weather-layers.service';

@Component({
	selector: 'app-sidebar',
	standalone: true,
	templateUrl: './sidebar.component.html',
	styleUrl: './sidebar.component.scss',
	imports: [CommonModule, MatIconModule, MatExpansionModule],
})
export class SidebarComponent implements OnInit {
	forecastLayers$!: Observable<ForecastLayer[]>;
	eventLayers$!: Observable<EventLayer[]>;
	radarLayers$!: Observable<EventLayer[]>;

	eventLayers: EventLayer[] = [];
	radarLayers: EventLayer[] = [];
	sidebarVisible: boolean = false;
	sourceLayerType = SourceLayerType;
	hasEvents: boolean = false;

	constructor(private weatherLayerService: WeatherLayersService) {}

	ngOnInit(): void {
		this.forecastLayers$ = this.weatherLayerService.forecastLayers$;
		this.eventLayers$ = this.weatherLayerService.eventLayers$;
		this.radarLayers$ = this.weatherLayerService.radarLayers$;

		this.eventLayers$.subscribe((eventLayers) => {
			this.hasEvents = this.weatherLayerService.hasEvents();
			this.eventLayers = [...eventLayers].sort((a, b) =>
				a.name.localeCompare(b.name),
			);
		});

		this.radarLayers$.subscribe((radarLayers) => {
			this.radarLayers = [...radarLayers];
		});
	}

	toggleLayerVisibility(
		sourceType: SourceLayerType,
		layerName: string,
	): void {
		this.weatherLayerService.toggleLayerVisibility(sourceType, layerName);
	}

	toggleSidebar() {
		this.sidebarVisible = !this.sidebarVisible;
	}
}
