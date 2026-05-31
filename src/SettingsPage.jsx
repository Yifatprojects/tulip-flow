import MFAComponent from './MFAComponent.tsx';

export default function SettingsPage() {
  return (
    <div style={{ padding: '40px', maxWidth: '600px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1>Settings</h1>
      <p style={{ color: '#666' }}>Manage your account security and authentication.</p>
      
      <div style={{ margin: '20px 0', padding: '20px', border: '1px solid #eee', borderRadius: '8px' }}>
        <MFAComponent />
      </div>
    </div>
  );
}