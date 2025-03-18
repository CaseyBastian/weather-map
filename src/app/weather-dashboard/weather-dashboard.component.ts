import { Component } from '@angular/core';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { WeatherMapComponent } from '../weather-map/weather-map.component';
import { InfoPanelComponent } from '../info-panel/info-panel.component';

@Component({
	selector: 'app-weather-dashboard',
	standalone: true,
	templateUrl: './weather-dashboard.component.html',
	styleUrls: ['./weather-dashboard.component.scss'],
	imports: [SidebarComponent, WeatherMapComponent, InfoPanelComponent],
})
export class WeatherDashboardComponent {}
