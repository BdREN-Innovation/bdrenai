import { render, screen } from '@testing-library/react';
import { Dialog } from './Dialog';

const noop = () => undefined;

describe('Dialog', () => {
  it('leaves out the empty body when a dialog only has a description', () => {
    render(
      <Dialog open onOpenChange={noop} title="Cancel the switch" description="Nothing changes." footer={<button>OK</button>}>
        {null}
        {false}
      </Dialog>,
    );
    expect(screen.getByRole('dialog').querySelector('[data-dialog-body]')).toBeNull();
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
  });

  it('renders the body when it has content', () => {
    render(
      <Dialog open onOpenChange={noop} title="Invite" footer={<button>Send</button>}>
        <p>Email field</p>
      </Dialog>,
    );
    const body = screen.getByRole('dialog').querySelector('[data-dialog-body]');
    expect(body).not.toBeNull();
    expect(body).toHaveTextContent('Email field');
  });
});
