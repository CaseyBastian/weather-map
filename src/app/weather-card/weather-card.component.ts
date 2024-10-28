import { Component, Input } from '@angular/core';
import { Period } from '../services/weather-layers.service';

@Component({
  selector: 'app-weather-card',
  standalone: true,
  imports: [],
  templateUrl: './weather-card.component.html',
  styleUrl: './weather-card.component.scss'
})
export class WeatherCardComponent {
  @Input() forecastPeriod!: Period;
}
