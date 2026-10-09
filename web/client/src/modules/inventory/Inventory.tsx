/** Inventory module screens under /inventory (own routes; the main app only mounts this). */
import { Route, Routes } from 'react-router-dom';
import { Bins } from './pages/Bins';
import { InvDashboard } from './pages/Dashboard';
import { Issues } from './pages/Issues';
import { Items } from './pages/Items';
import { Locations } from './pages/Locations';
import { Masters } from './pages/Masters';
import { Purchase } from './pages/Purchase';
import { InvReports } from './pages/Reports';
import { Requisitions } from './pages/Requisitions';
import { ScanStation } from './pages/ScanStation';
import { StockOps } from './pages/StockOps';
import { Units } from './pages/Units';
import { InvProvider } from './shared';

export function Inventory() {
  return (
    <InvProvider>
      <Routes>
        <Route index element={<InvDashboard />} />
        <Route path="items" element={<Items />} />
        <Route path="requisitions" element={<Requisitions />} />
        <Route path="issues" element={<Issues />} />
        <Route path="purchase" element={<Purchase />} />
        <Route path="stock" element={<StockOps />} />
        <Route path="masters" element={<Masters />} />
        <Route path="scan" element={<ScanStation />} />
        <Route path="bins" element={<Bins />} />
        <Route path="units" element={<Units />} />
        <Route path="locations" element={<Locations />} />
        <Route path="reports" element={<InvReports />} />
        <Route path="*" element={<InvDashboard />} />
      </Routes>
    </InvProvider>
  );
}
