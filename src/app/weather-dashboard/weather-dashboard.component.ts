import { Component, inject } from '@angular/core';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { WeatherMapComponent } from '../weather-map/weather-map.component';
import { InfoPanelComponent } from '../info-panel/info-panel.component';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { WeatherLayersService } from '../services/weather-layers.service';

@Component({
	selector: 'app-weather-dashboard',
	standalone: true,
	templateUrl: './weather-dashboard.component.html',
	styleUrls: ['./weather-dashboard.component.scss'],
	imports: [
		CommonModule,
		SidebarComponent,
		WeatherMapComponent,
		InfoPanelComponent,
		MatIconModule,
	],
})
export class WeatherDashboardComponent {
	private weatherLayersService = inject(WeatherLayersService);
	refreshStatus$ = this.weatherLayersService.refreshStatus$;

	refreshData(): void {
		this.weatherLayersService.requestDataRefresh();
	}

	refreshLabel(lastUpdated: Date | null): string {
		if (!lastUpdated) return 'Connecting to live data';
		return `Updated ${lastUpdated.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
		})}`;
	}
}
