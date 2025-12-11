'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

interface Trainer {
  id: string;
  name: string;
  status: string;
  dualRecordingRequired: boolean;
}

interface TrainerRequest {
  id: string;
  trainerName: string;
  requesterName: string;
  status: string;
  createdAt: number;
}

export default function TrainerManager() {
  const { user } = useAuth();
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [requests, setRequests] = useState<TrainerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add/Edit Trainer Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingTrainer, setEditingTrainer] = useState<Trainer | null>(null);
  const [trainerName, setTrainerName] = useState('');
  const [trainerStatus, setTrainerStatus] = useState<string>('approved');
  const [dualRecordingRequired, setDualRecordingRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Fetch Trainers and Requests
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    if (!user) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      const idToken = await user.getIdToken();

      // Fetch trainers
      const trainersRes = await fetch(`${apiUrl}/trainers`);
      if (trainersRes.ok) {
        const trainersData = await trainersRes.json();
        setTrainers(trainersData.trainers || []);
      }

      // Fetch requests
      const requestsRes = await fetch(`${apiUrl}/trainers/requests`, {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (requestsRes.ok) {
        const requestsData = await requestsRes.json();
        setRequests(requestsData.requests || []);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddModal = () => {
    setEditingTrainer(null);
    setTrainerName('');
    setTrainerStatus('approved');
    setDualRecordingRequired(false);
    setShowModal(true);
  };

  const handleOpenEditModal = (trainer: Trainer) => {
    setEditingTrainer(trainer);
    setTrainerName(trainer.name);
    setTrainerStatus(trainer.status);
    setDualRecordingRequired(trainer.dualRecordingRequired);
    setShowModal(true);
  };

  const handleSaveTrainer = async () => {
    if (!user || !trainerName.trim()) return;

    setSubmitting(true);
    setError('');

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      const idToken = await user.getIdToken();

      const method = editingTrainer ? 'PUT' : 'POST';
      const url = editingTrainer 
        ? `${apiUrl}/trainers/${editingTrainer.id}`
        : `${apiUrl}/trainers`;

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          name: trainerName,
          status: trainerStatus,
          dualRecordingRequired
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to save trainer');

      setSuccess(editingTrainer ? 'Trainer updated!' : 'Trainer added!');
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTrainer = async (trainerId: string) => {
    if (!user || !confirm('Are you sure you want to delete this trainer?')) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      const idToken = await user.getIdToken();

      const res = await fetch(`${apiUrl}/trainers/${trainerId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${idToken}` }
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to delete trainer');

      setSuccess('Trainer deleted!');
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleApproveRequest = async (requestId: string, requireDualRecording: boolean) => {
    if (!user) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      const idToken = await user.getIdToken();

      const res = await fetch(`${apiUrl}/trainers/requests/${requestId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ dualRecordingRequired: requireDualRecording })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to approve request');

      setSuccess('Request approved and trainer added!');
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    if (!user || !confirm('Are you sure you want to reject this request?')) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      const idToken = await user.getIdToken();

      const res = await fetch(`${apiUrl}/trainers/requests/${requestId}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${idToken}` }
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to reject request');

      setSuccess('Request rejected!');
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) return <div className="text-center py-8">Loading trainers...</div>;

  const approvedTrainers = trainers.filter(t => t.status === 'approved');
  const notApprovedTrainers = trainers.filter(t => t.status === 'not_approved');
  const pendingRequests = requests.filter(r => r.status === 'pending');

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-md border border-red-200">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 text-green-700 p-4 rounded-md border border-green-200">
          {success}
        </div>
      )}

      {/* Pending Requests Section */}
      {pendingRequests.length > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4 text-yellow-900 dark:text-yellow-100">
            🔔 Pending Approval Requests ({pendingRequests.length})
          </h2>
          <div className="space-y-3">
            {pendingRequests.map(request => (
              <div key={request.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-yellow-300 dark:border-yellow-700">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-lg">{request.trainerName}</h3>
                    <p className="text-sm text-muted-foreground">
                      Requested by: {request.requesterName || 'Unknown'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(request.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApproveRequest(request.id, false)}
                      className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleApproveRequest(request.id, true)}
                      className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                    >
                      Approve (Dual Rec.)
                    </button>
                    <button
                      onClick={() => handleRejectRequest(request.id)}
                      className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approved Trainers */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">✓ Approved Trainers ({approvedTrainers.length})</h2>
          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 font-medium"
          >
            + Add Trainer
          </button>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-semibold text-sm">Trainer Name</th>
                <th className="text-left p-3 font-semibold text-sm">Dual Recording</th>
                <th className="text-right p-3 font-semibold text-sm">Actions</th>
              </tr>
            </thead>
            <tbody>
              {approvedTrainers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center p-8 text-muted-foreground">
                    No approved trainers yet. Click "+ Add Trainer" to add one.
                  </td>
                </tr>
              ) : (
                approvedTrainers.map((trainer, index) => (
                  <tr key={trainer.id} className={`border-t border-border ${index % 2 === 0 ? 'bg-background' : 'bg-muted/20'}`}>
                    <td className="p-3">
                      <span className="font-medium">{trainer.name}</span>
                    </td>
                    <td className="p-3">
                      {trainer.dualRecordingRequired ? (
                        <span className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 px-2 py-1 rounded inline-flex items-center gap-1">
                          ⚠️ Required
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not Required</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => handleOpenEditModal(trainer)}
                          className="px-3 py-1 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 text-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteTrainer(trainer.id)}
                          className="px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-900/50 text-sm"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Not Approved Trainers */}
      {notApprovedTrainers.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold mb-4">✗ Not Approved Trainers ({notApprovedTrainers.length})</h2>
          <div className="border border-red-200 dark:border-red-800 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-red-100 dark:bg-red-900/30">
                <tr>
                  <th className="text-left p-3 font-semibold text-sm">Trainer Name</th>
                  <th className="text-left p-3 font-semibold text-sm">Status</th>
                  <th className="text-right p-3 font-semibold text-sm">Actions</th>
                </tr>
              </thead>
              <tbody>
                {notApprovedTrainers.map((trainer, index) => (
                  <tr key={trainer.id} className={`border-t border-red-200 dark:border-red-800 ${index % 2 === 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-red-100 dark:bg-red-900/30'}`}>
                    <td className="p-3">
                      <span className="font-medium">{trainer.name}</span>
                    </td>
                    <td className="p-3">
                      <span className="text-xs bg-red-200 dark:bg-red-900/50 text-red-800 dark:text-red-200 px-2 py-1 rounded inline-flex items-center gap-1">
                        ✗ NOT APPROVED
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => handleOpenEditModal(trainer)}
                          className="px-3 py-1 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 text-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteTrainer(trainer.id)}
                          className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add/Edit Trainer Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card w-full max-w-md rounded-lg shadow-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/30">
              <h3 className="text-lg font-bold text-card-foreground">
                {editingTrainer ? 'Edit Trainer' : 'Add Trainer'}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Trainer Name</label>
                <input
                  type="text"
                  value={trainerName}
                  onChange={e => setTrainerName(e.target.value)}
                  placeholder="e.g., Wahoo KICKR V6"
                  className="w-full p-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none transition-all text-foreground bg-background"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Status</label>
                <select
                  value={trainerStatus}
                  onChange={e => setTrainerStatus(e.target.value)}
                  className="w-full p-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none transition-all text-foreground bg-background"
                >
                  <option value="approved">✓ Approved</option>
                  <option value="not_approved">✗ Not Approved</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="dualRecording"
                  checked={dualRecordingRequired}
                  onChange={e => setDualRecordingRequired(e.target.checked)}
                  className="w-4 h-4"
                />
                <label htmlFor="dualRecording" className="text-sm">
                  Dual Recording Required
                </label>
              </div>
            </div>
            <div className="p-4 border-t border-border bg-muted/30 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTrainer}
                disabled={submitting || !trainerName.trim()}
                className="px-6 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

