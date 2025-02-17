import { AfterViewInit, Component, OnDestroy } from '@angular/core';
import { InfoPanelService, InfoType } from '../services/info-panel.service';
import { WeatherCardComponent } from '../weather-card/weather-card.component';
import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-info-panel',
  standalone: true,
  imports: [CommonModule, WeatherCardComponent],
  templateUrl: './info-panel.component.html',
  styleUrl: './info-panel.component.scss'
})
export class InfoPanelComponent implements AfterViewInit, OnDestroy{
  infoPanelVisible: boolean = false;
  infoPanelType: InfoType | undefined;
  infoPanelData: any;

  infoPanelCurrentData: any = undefined;
  infoPanelHourly: any = undefined;
  infoPanelDaily: any = undefined;

  InfoType = InfoType;

  private destroy$ = new Subject<void>();
  constructor(private infoPanelService: InfoPanelService) {}

  ngAfterViewInit(): void {
    this.infoPanelService.infoPanelVisible$
      .pipe(takeUntil(this.destroy$))
      .subscribe(visible => this.infoPanelVisible = visible);

    this.infoPanelService.infoPanelType$
      .pipe(takeUntil(this.destroy$))
      .subscribe(infoType => this.infoPanelType = infoType);

    this.infoPanelService.infoPanelData$
      .pipe(takeUntil(this.destroy$))
      .subscribe(data => this.updateInfoPanel(data));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  updateInfoPanel(data: any) : void {
    this.infoPanelData = data;
  }

  getTime(dateTime: string): string {
    const date = new Date(dateTime);
    const hours = date.getHours().toString().padStart(2,'0');
    return hours;
  }

  get isImpacted(): boolean
  {
    console.log(this.infoPanelData.impacted, this.infoPanelData.impactingEvents.length > 0);
    return this.infoPanelData.impacted && this.infoPanelData.impactingEvents.length > 0;
  }

  get hasInfoPanelData(): boolean {
    return !!this.infoPanelType && !!this.infoPanelData;
  }

  get hasForecastData(): boolean {
    return this.hasInfoPanelData && this.infoPanelType === InfoType.FORECAST; 
  }

  get hasEventData(): boolean {
    return this.hasInfoPanelData && this.infoPanelType === InfoType.EVENT; 
  }

  get getCurrentForecast() {
    return this.infoPanelData.hourlyForecast[0];
  }

  get getHourlyForecast() {
    return this.infoPanelData.hourlyForecast.slice(1);
  }

  get getDailyForecast() {
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() +1);
    return this.infoPanelData.periods.filter((period : any) => {
      const periodDate = new Date(period.startTime);
      return periodDate >= startDate && periodDate < endDate;
    });
  }
}
