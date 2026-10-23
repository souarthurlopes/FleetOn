document.addEventListener('click',event=>{
 const link=event.target.closest('[data-overview-page]');
 if(link&&cloud.context?.role==='manager')navigateLayout(link.dataset.overviewPage);
 if(event.target.closest('[data-overview-inuse]')&&cloud.context?.role==='manager'){
  vehicleFilter={query:'',status:'inuse',driver:''};cars();navigateLayout('car');
 }
});

document.addEventListener('toggle',event=>{if(event.target.id==='dashboard-analysis-disclosure'){dashboardAnalyticsOpen=event.target.open;if(dashboardAnalyticsOpen)renderDashboardAnalytics();}},true);
